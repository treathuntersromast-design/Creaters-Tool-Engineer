import { HearingAnswer } from '../db/repositories/hearingAnswerRepository';
import {
  requirementsTemplate,
  basicDesignTemplate,
  detailedDesignTemplate,
  testResultTemplate,
  sampleTestTemplate,
} from './templates';

export interface GeneratedDocument {
  path: string;
  content: string;
}

export function generateRequirements(answers: HearingAnswer, projectName: string): GeneratedDocument {
  return {
    path: 'docs/requirements.md',
    content: requirementsTemplate(answers, projectName),
  };
}

export function generateBasicDesign(answers: HearingAnswer, projectName: string): GeneratedDocument {
  return {
    path: 'docs/basic-design.md',
    content: basicDesignTemplate(answers, projectName),
  };
}

export function generateDetailedDesign(answers: HearingAnswer, projectName: string): GeneratedDocument {
  return {
    path: 'docs/detailed-design.md',
    content: detailedDesignTemplate(answers, projectName),
  };
}

export function generateTestResult(projectName: string): GeneratedDocument {
  return {
    path: 'logs/test-result.md',
    content: testResultTemplate(projectName, 2, 0),
  };
}

export function generateSampleTest(projectName: string): GeneratedDocument {
  return {
    path: 'tests/sample.test.ts',
    content: sampleTestTemplate(projectName),
  };
}

export function generateRevision(content: string, revisionNumber: number): GeneratedDocument {
  return {
    path: `docs/revisions/revision-${revisionNumber}.md`,
    content: `# 修正依頼 #${revisionNumber}\n\n**日時:** ${new Date().toISOString()}\n\n## 内容\n\n${content}\n`,
  };
}
