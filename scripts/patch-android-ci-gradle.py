#!/usr/bin/env python3
"""Patch Expo prebuild android/app/build.gradle for sideloadable CI APKs.

Debug APKs skip the JS bundle and wait for Metro — devices then stick on the
Expo splash forever. We force debuggableVariants=[] and debug-signed release.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

p = Path("android/app/build.gradle")
if not p.is_file():
    print(f"missing {p}", file=sys.stderr)
    sys.exit(1)

t = p.read_text()
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
    p.write_text(t)
    print("patched android/app/build.gradle for embedded JS + debug-signed release")
else:
    print("build.gradle already suitable or unexpected shape — relevant lines:")
    for line in t.splitlines():
        if any(k in line for k in ("react {", "debuggable", "signingConfig", "release {", "debug {")):
            print(line)
