"use client";

import { useMemo, useState } from "react";

type CopilotMessage = {
  role: "user" | "assistant";
  text: string;
};

type WorkflowCopilotProps = {
  industry: string | null;
  client: string | null;
  selectedWorkflowKey: string | null;
  editorContent: string;
};

export default function WorkflowCopilot({
  industry,
  client,
  selectedWorkflowKey,
  editorContent,
}: WorkflowCopilotProps) {
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      role: "assistant",
      text: "I can help with workflow setup, database queries, and knowledge-base nodes. Ask me what to configure.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [kbAware, setKbAware] = useState(true);
  const [useContext, setUseContext] = useState(true);

  const parsedConfig = useMemo(() => {
    try {
      return JSON.parse(editorContent || "{}");
    } catch {
      return {};
    }
  }, [editorContent]);

  async function sendMessage() {
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    try {
      const res = await fetch("/api/copilot/workflow-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: question,
          context: {
            industry,
            client,
            selectedWorkflowKey,
            kbAware,
            useContext,
            configSnapshot: useContext ? parsedConfig : null,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = String(data?.error || `Request failed (${res.status})`);
        setMessages((prev) => [...prev, { role: "assistant", text: `Error: ${err}` }]);
      } else {
        const reply = String(data?.reply || "No response generated.");
        setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      }
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", text: "Error: assistant request failed." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 border border-gray-700 rounded bg-gray-900/70 h-full min-h-[260px] flex flex-col">
      <div className="px-3 py-2 border-b border-gray-700">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">Workflow Assistant</div>
        <div className="text-[11px] text-gray-500 mt-1 truncate">
          {client ? `${client} / ${industry || "-"}` : "No client selected"}
        </div>
      </div>
      <div className="px-3 py-2 border-b border-gray-700 grid grid-cols-2 gap-2 text-[11px]">
        <label className="flex items-center gap-2 text-gray-300">
          <input
            type="checkbox"
            checked={useContext}
            onChange={(e) => setUseContext(e.target.checked)}
            className="accent-blue-500"
          />
          Use config context
        </label>
        <label className="flex items-center gap-2 text-gray-300">
          <input
            type="checkbox"
            checked={kbAware}
            onChange={(e) => setKbAware(e.target.checked)}
            className="accent-blue-500"
          />
          KB-aware answers
        </label>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.map((m, idx) => (
          <div
            key={`copilot-msg-${idx}`}
            className={`text-xs rounded px-2 py-1 whitespace-pre-wrap ${
              m.role === "assistant" ? "bg-gray-800 text-gray-200" : "bg-blue-900/40 text-blue-200"
            }`}
          >
            {m.text}
          </div>
        ))}
      </div>
      <div className="p-2 border-t border-gray-700">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-full h-16 bg-gray-800 border border-gray-600 rounded p-2 text-xs text-white resize-none"
          placeholder="Ask how to configure a node, DB query, or KB lookup..."
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="mt-2 w-full px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400"
        >
          {loading ? "Thinking..." : "Ask Assistant"}
        </button>
      </div>
    </div>
  );
}

