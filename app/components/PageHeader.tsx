export default function PageHeader() {
  return (
    <header className="bg-white dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700 shadow-sm">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          🧩 Building Effective Agents
        </h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
          A hands-on walkthrough of the patterns from Anthropic&apos;s{" "}
          <a
            href="https://www.anthropic.com/engineering/building-effective-agents"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700 dark:hover:text-zinc-200"
          >
            &quot;Building Effective Agents&quot;
          </a>{" "}
          post
        </p>
      </div>
    </header>
  );
}
