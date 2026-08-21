export type MainTab =
  | "augmented-llm"
  | "prompt-chaining"
  | "routing"
  | "parallelization"
  | "orchestrator-workers"
  | "evaluator-optimizer"
  | "agent"
  | "previous-chats";

// ─── Tab metadata ──────────────────────────────────────────────────────────────
// Central registry mapping each building-block tab id to its display label
// and icon. Used both by the nav bar itself and by the "Previous Chats" tab
// to render a human-readable label for the tab a saved session came from.
export const TAB_META: Record<
  Exclude<MainTab, "previous-chats">,
  { label: string; icon: string }
> = {
  "augmented-llm": { label: "Building block: The augmented LLM", icon: "🧱" },
  "prompt-chaining": { label: "Workflow: Prompt chaining", icon: "🔗" },
  routing: { label: "Workflow: Routing", icon: "🚦" },
  parallelization: { label: "Workflow: Parallelization", icon: "🧵" },
  "orchestrator-workers": { label: "Workflow: Orchestrator-workers", icon: "🧭" },
  "evaluator-optimizer": { label: "Workflow: Evaluator-optimizer", icon: "🧑‍⚖️" },
  agent: { label: "Agents", icon: "🤖" },
};

interface TabNavigationProps {
  activeTab: MainTab;
  onTabChange: (tab: MainTab) => void;
}

export default function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <nav className="bg-white dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex gap-0">
          <button
            onClick={() => onTabChange("previous-chats")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "previous-chats"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
            }`}
          >
            🕘 Previous Chats
          </button>
          <button
            onClick={() => onTabChange("augmented-llm")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "augmented-llm"
                ? "border-blue-500 text-blue-600 dark:text-blue-400"
                : "border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
            }`}
          >
            {TAB_META["augmented-llm"].icon} {TAB_META["augmented-llm"].label}
          </button>
          <button
            onClick={() => onTabChange("prompt-chaining")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "prompt-chaining"
                ? "border-purple-500 text-purple-600 dark:text-purple-400"
                : "border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
            }`}
          >
            {TAB_META["prompt-chaining"].icon} {TAB_META["prompt-chaining"].label}
          </button>
          <button
            onClick={() => onTabChange("routing")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "routing"
                ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                : "border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
            }`}
          >
            {TAB_META["routing"].icon} {TAB_META["routing"].label}
          </button>
          <button
            onClick={() => onTabChange("parallelization")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "parallelization"
                ? "border-amber-500 text-amber-600 dark:text-amber-400"
                : "border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
            }`}
          >
            {TAB_META["parallelization"].icon} {TAB_META["parallelization"].label}
          </button>
          <button
            onClick={() => onTabChange("orchestrator-workers")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "orchestrator-workers"
                ? "border-teal-500 text-teal-600 dark:text-teal-400"
                : "border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
            }`}
          >
            {TAB_META["orchestrator-workers"].icon} {TAB_META["orchestrator-workers"].label}
          </button>
          <button
            onClick={() => onTabChange("evaluator-optimizer")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "evaluator-optimizer"
                ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
            }`}
          >
            {TAB_META["evaluator-optimizer"].icon} {TAB_META["evaluator-optimizer"].label}
          </button>
          <button
            onClick={() => onTabChange("agent")}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "agent"
                ? "border-rose-500 text-rose-600 dark:text-rose-400"
                : "border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200"
            }`}
          >
            {TAB_META["agent"].icon} {TAB_META["agent"].label}
          </button>
        </div>
      </div>
    </nav>
  );
}
