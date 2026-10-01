import { useEffect, useState } from "react";
import { Linking, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cn } from "@/lib/cn";

export const FEEDBACK_EMAIL = "feedback@zakura.example.com";

export function FeedbackSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (visible) {
      setMessage("");
      setFailed(false);
    }
  }, [visible]);

  const send = async () => {
    const body = message.trim();
    const url = `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent("Zakura Bot feedback")}${body ? `&body=${encodeURIComponent(body)}` : ""}`;
    setFailed(false);
    try {
      await Linking.openURL(url);
      onClose();
    } catch {
      setFailed(true);
    }
  };

  const empty = message.trim().length === 0;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 justify-end" accessibilityViewIsModal>
        <Pressable className="absolute inset-0 bg-black/60" onPress={onClose} accessibilityLabel="Close feedback" accessible={false} focusable={false} />
        <View className="rounded-t-3xl bg-panel px-4 pt-4" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          <Text className="text-[17px] font-medium text-ink">Send feedback</Text>
          <Text className="mt-1 text-[13px] leading-5 text-ink-secondary">Tell us what worked or what didn't. This opens your email app.</Text>
          <TextInput value={message} onChangeText={setMessage} multiline
            placeholder="What would you like to share?" placeholderTextColor="#8a8a8a"
            accessibilityLabel="Feedback message" textAlignVertical="top"
            className="mt-3 min-h-28 rounded-2xl bg-inset px-3 py-3 text-[15px] text-ink outline-none" />
          {failed ? <Text accessibilityRole="alert" className="mt-2 text-[13px] text-danger">No email app is available on this device.</Text> : null}
          <View className="mt-3 flex-row items-center justify-end gap-1">
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel feedback"
              className="min-h-11 items-center justify-center rounded-full px-4 active:bg-raised/40">
              <Text className="text-[15px] text-ink-secondary">Cancel</Text>
            </Pressable>
            <Pressable onPress={() => void send()} disabled={empty} accessibilityRole="button" accessibilityLabel="Send feedback"
              accessibilityState={{ disabled: empty }}
              className={cn("min-h-11 items-center justify-center rounded-full bg-ink px-5", empty && "opacity-40")}>
              <Text className="text-[15px] font-semibold text-app">Send</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
