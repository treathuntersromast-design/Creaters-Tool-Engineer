import { Agent } from './Agent';
import { LeaderAgent } from './LeaderAgent';
import { RequirementAgent } from './RequirementAgent';
import { DesignAgent } from './DesignAgent';
import { ImplementationAgent } from './ImplementationAgent';
import { TestAgent } from './TestAgent';
import { ReviewAgent } from './ReviewAgent';
import { MockCodeExecutor } from '../executors/MockCodeExecutor';
import { AiClient } from '../ai/aiClient';

export class AgentFactory {
  private readonly leaderAgent: LeaderAgent;
  private readonly phaseAgents: Map<string, Agent>;

  constructor(aiClient?: AiClient) {
    this.leaderAgent = new LeaderAgent();
    this.phaseAgents = new Map<string, Agent>([
      ['requirements',    new RequirementAgent(aiClient)],
      ['basic_design',    new DesignAgent('basic_design', aiClient)],
      ['detailed_design', new DesignAgent('detailed_design', aiClient)],
      ['implementation',  new ImplementationAgent(new MockCodeExecutor(), aiClient)],
      ['testing',         new TestAgent(aiClient)],
      ['review',          new ReviewAgent(aiClient)],
    ]);
  }

  getLeaderAgent(): LeaderAgent {
    return this.leaderAgent;
  }

  getAgentForPhase(phase: string): Agent {
    const agent = this.phaseAgents.get(phase);
    if (!agent) throw new Error(`No agent for phase: ${phase}`);
    return agent;
  }

  getAllAgents(): Agent[] {
    return [this.leaderAgent, ...Array.from(this.phaseAgents.values())];
  }
}
