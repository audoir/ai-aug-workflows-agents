"use client";

import { useCallback, useState } from "react";
import PageHeader from "@/app/components/PageHeader";
import TabNavigation, { type MainTab } from "@/app/components/TabNavigation";
import AugmentedLLM from "@/app/components/AugmentedLLM";
import PromptChain from "@/app/components/PromptChain";
import Routing from "@/app/components/Routing";
import Parallelization from "@/app/components/Parallelization";
import OrchestratorWorkers from "@/app/components/OrchestratorWorkers";
import EvaluatorOptimizer from "@/app/components/EvaluatorOptimizer";
import Agent from "@/app/components/Agent";
import PreviousChats from "@/app/components/PreviousChats";

export default function Home() {
  const [mainTab, setMainTab] = useState<MainTab>("augmented-llm");
  // sessionId of a previous chat the user clicked in the Previous Chats tab,
  // pending being consumed by the tab it belongs to.
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);

  const handleRestoreChat = useCallback((tab: MainTab, sessionId: string) => {
    setPendingRestore(sessionId);
    setMainTab(tab);
  }, []);

  const handleRestoreConsumed = useCallback(() => {
    setPendingRestore(null);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-zinc-900 font-sans">
      <PageHeader />
      <TabNavigation activeTab={mainTab} onTabChange={setMainTab} />
      <div className={mainTab === "augmented-llm" ? undefined : "hidden"}>
        <AugmentedLLM
          restoreSessionId={mainTab === "augmented-llm" ? pendingRestore : null}
          onRestoreConsumed={handleRestoreConsumed}
        />
      </div>
      <div className={mainTab === "prompt-chaining" ? undefined : "hidden"}>
        <PromptChain
          restoreSessionId={mainTab === "prompt-chaining" ? pendingRestore : null}
          onRestoreConsumed={handleRestoreConsumed}
        />
      </div>
      <div className={mainTab === "routing" ? undefined : "hidden"}>
        <Routing
          restoreSessionId={mainTab === "routing" ? pendingRestore : null}
          onRestoreConsumed={handleRestoreConsumed}
        />
      </div>
      <div className={mainTab === "parallelization" ? undefined : "hidden"}>
        <Parallelization
          restoreSessionId={mainTab === "parallelization" ? pendingRestore : null}
          onRestoreConsumed={handleRestoreConsumed}
        />
      </div>
      <div className={mainTab === "orchestrator-workers" ? undefined : "hidden"}>
        <OrchestratorWorkers
          restoreSessionId={mainTab === "orchestrator-workers" ? pendingRestore : null}
          onRestoreConsumed={handleRestoreConsumed}
        />
      </div>
      <div className={mainTab === "evaluator-optimizer" ? undefined : "hidden"}>
        <EvaluatorOptimizer
          restoreSessionId={mainTab === "evaluator-optimizer" ? pendingRestore : null}
          onRestoreConsumed={handleRestoreConsumed}
        />
      </div>
      <div className={mainTab === "agent" ? undefined : "hidden"}>
        <Agent
          restoreSessionId={mainTab === "agent" ? pendingRestore : null}
          onRestoreConsumed={handleRestoreConsumed}
        />
      </div>
      <div className={mainTab === "previous-chats" ? undefined : "hidden"}>
        <PreviousChats
          onRestoreChat={handleRestoreChat}
          isActive={mainTab === "previous-chats"}
        />
      </div>
    </div>
  );
}
