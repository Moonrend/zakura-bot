#!/usr/bin/env python3
"""Patch Expo prebuild Android Gradle files for sideloadable CI APKs.

1) Debug APKs skip the JS bundle and wait for Metro — devices stick on Expo splash.
   Force debuggableVariants=[] and debug-signed release so the bundle is embedded.
2) GitHub runners often OOM with Metaspace during assembleRelease (Kotlin/AGP).
   Raise MaxMetaspaceSize, cap workers, and disable parallel compile contention.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

APP = Path("android/app/build.gradle")
PROPS = Path("android/gradle.properties")


def patch_app_gradle() -> None:
    if not APP.is_file():
        print(f"missing {APP}", file=sys.stderr)
        sys.exit(1)

    t = APP.read_text()
    changed = False

    if "debuggableVariants" not in t and "react {" in t:
        t = t.replace(
            "react {",
            "react {\n"
            "    // Sideloaded CI APKs must embed JS (empty = bundle every variant).\n"
            "    debuggableVariants = []",
            1,
        )
        changed = True

    if "signingConfig signingConfigs.debug" not in t and "buildTypes" in t:
        t2, n = re.subn(
            r"(release\s*\{)",
            r"\1\n"
            r"            // Internal testing: debug-signed release still embeds the JS bundle.\n"
            r"            signingConfig signingConfigs.debug",
            t,
            count=1,
        )
        if n:
            t = t2
            changed = True

    if changed:
        APP.write_text(t)
        print("patched android/app/build.gradle for embedded JS + debug-signed release")
    else:
        print("android/app/build.gradle already suitable or unexpected shape")


def upsert_prop(text: str, key: str, value: str) -> str:
    line = f"{key}={value}"
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.M)
    if pattern.search(text):
        return pattern.sub(line, text)
    if text and not text.endswith("\n"):
        text += "\n"
    return text + line + "\n"


def patch_gradle_properties() -> None:
    if not PROPS.is_file():
        print(f"missing {PROPS}", file=sys.stderr)
        sys.exit(1)

    t = PROPS.read_text()
    # Heap + Metaspace: default Metaspace is too small for AGP/Kotlin on GHA.
    # Keep Xmx modest so heap+metaspace fit a 7GB runner with Node leftover.
    t = upsert_prop(
        t,
        "org.gradle.jvmargs",
        "-Xmx3g -XX:MaxMetaspaceSize=1g -XX:ReservedCodeCacheSize=256m "
        "-XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8",
    )
    t = upsert_prop(
        t,
        "kotlin.daemon.jvmargs",
        "-Xmx1536m -XX:MaxMetaspaceSize=768m",
    )
    t = upsert_prop(t, "org.gradle.parallel", "false")
    t = upsert_prop(t, "org.gradle.workers.max", "2")
    t = upsert_prop(t, "org.gradle.daemon", "false")
    t = upsert_prop(t, "org.gradle.caching", "true")
    # Single ABI already set by workflow; reinforce here.
    t = upsert_prop(t, "reactNativeArchitectures", "arm64-v8a")
    PROPS.write_text(t)
    print("patched android/gradle.properties for Metaspace / worker limits")
    for line in PROPS.read_text().splitlines():
        if any(
            line.startswith(k)
            for k in (
                "org.gradle.jvmargs",
                "kotlin.daemon",
                "org.gradle.parallel",
                "org.gradle.workers",
                "org.gradle.daemon",
                "reactNativeArchitectures",
            )
        ):
            print(" ", line)


def main() -> None:
    patch_app_gradle()
    patch_gradle_properties()


if __name__ == "__main__":
    main()
