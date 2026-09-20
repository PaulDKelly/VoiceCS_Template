"use client";

import { useMemo, useState } from "react";
import { FilePlus2, Send, WandSparkles } from "lucide-react";

type CopilotProposal = {
  kind: "workflow_draft" | "new_client_draft";
  proposedConfig?: Record<string, any>;
  clientDraft?: Record<string, any>;
  changeSummary: string[];
};

type CopilotMessage = {
  role: "user" | "assistant";
  text: string;
  proposal?: CopilotProposal;
};

type WorkflowCopilotProps = {
  industry: string | null;
  client: string | null;
  selectedWorkflowKey: string | null;
  editorContent: string;
  onApplyDraft: (config: Record<string, any>, changeSummary: string[]) => void;
  onPrepareClient: (draft: Record<string, any>) => void;
};

export default function WorkflowCopilot({
  industry,
  client,
  selectedWorkflowKey,
  editorContent,
  onApplyDraft,
  onPrepareClient,
}: WorkflowCopilotProps) {
  const [messages, setMessages] = useState<CopilotMessage[]>([
    {
      role: "assistant",
      text: "I can design and diagnose workflows, add prompt nodes, or guide you through creating a client. I will ask for any details I need and let you review every proposed change.",
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
          conversation: messages.slice(-10),
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
        const questions = Array.isArray(data?.questions) ? data.questions.filter(Boolean) : [];
        const text = questions.length && !questions.every((item: string) => reply.includes(item))
          ? `${reply}\n\n${questions.map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
          : reply;
        const summary = Array.isArray(data?.change_summary) ? data.change_summary.map(String) : [];
        let proposal: CopilotProposal | undefined;
        if (data?.kind === "workflow_draft" && data?.proposed_config) {
          proposal = { kind: "workflow_draft", proposedConfig: data.proposed_config, changeSummary: summary };
        } else if (data?.kind === "new_client_draft" && data?.client_draft) {
          proposal = { kind: "new_client_draft", clientDraft: data.client_draft, changeSummary: summary };
        }
        setMessages((prev) => [...prev, { role: "assistant", text, proposal }]);
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
            className={`text-xs rounded px-2 py-2 whitespace-pre-wrap ${
              m.role === "assistant" ? "bg-gray-800 text-gray-200" : "bg-blue-900/40 text-blue-200"
            }`}
          >
            {m.text}
            {m.proposal && (
              <div className="mt-2 pt-2 border-t border-gray-700">
                {m.proposal.changeSummary.length > 0 && (
                  <ul className="mb-2 space-y-1 text-[11px] text-gray-400">
                    {m.proposal.changeSummary.map((item, summaryIndex) => (
                      <li key={`summary-${summaryIndex}`}>• {item}</li>
                    ))}
                  </ul>
                )}
                {m.proposal.kind === "workflow_draft" && m.proposal.proposedConfig && (
                  <button
                    type="button"
                    onClick={() => onApplyDraft(m.proposal!.proposedConfig!, m.proposal!.changeSummary)}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                    title="Apply this proposal to the unsaved editor draft"
                  >
                    <WandSparkles size={13} /> Apply to draft
                  </button>
                )}
                {m.proposal.kind === "new_client_draft" && m.proposal.clientDraft && (
                  <div>
                    <div className="mb-2 px-2 py-1.5 border border-amber-700 bg-amber-950/40 text-amber-200 text-[11px] rounded">
                      Draft only. No client has been created yet.
                    </div>
                    <button
                      type="button"
                      onClick={() => onPrepareClient(m.proposal!.clientDraft!)}
                      className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                      title="Review this proposal and confirm client creation"
                    >
                      <FilePlus2 size={13} /> Review &amp; create client
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="p-2 border-t border-gray-700">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-full h-16 bg-gray-800 border border-gray-600 rounded p-2 text-xs text-white resize-none"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          placeholder="Describe a workflow, request a node, diagnose an issue, or create a client..."
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          className="mt-2 w-full px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-400 flex items-center justify-center gap-1.5"
        >
          <Send size={13} /> {loading ? "Thinking..." : "Ask Assistant"}
        </button>
      </div>
    </div>
  );
}

