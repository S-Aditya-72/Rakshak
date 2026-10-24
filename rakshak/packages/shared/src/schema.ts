// Runtime validation of the analysis contract (rakshak.analysis.v1). The browser never trusts server JSON blindly.

import { z } from 'zod';
import { ASSESSMENTS, CONFIDENCES, CUES, MODIFIERS, SCHEMA_VERSION } from './index';

const cue = z.enum(CUES);
const backend = z.enum(['local_hybrid', 'chatgpt_cloud']);
const agreement = z.enum(['agree', 'contextual_only', 'context_override', 'needs_review', 'single_model']);
const evStatus = z.enum(['active', 'needs_review', 'superseded', 'suppressed']);

export const EvidenceEventSchema = z.object({
  key: z.string(),
  childId: z.string(),
  backend,
  conversationId: z.string(),
  messageId: z.string(),
  senderId: z.string(),
  targetId: z.string().nullable(),
  targetBasis: z.enum(['model', 'private_chat', 'unknown']),
  cue,
  category: z.enum(['grooming', 'bullying']),
  day: z.number().int(),
  seq: z.number().int(),
  p: z.number().min(0).max(1),
  modifier: z.enum(MODIFIERS),
  status: evStatus,
  agreement,
  sources: z.array(z.enum(['roberta', 'qwen', 'chatgpt'])),
  rationale: z.string(),
  runId: z.string(),
});

export const AnalysisResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  analysisId: z.string(),
  requestId: z.string(),
  backend,
  models: z.object({ contextual: z.string().nullable(), classifier: z.string().nullable() }),
  childId: z.string(),
  conversationId: z.string(),
  analyzedMessageIds: z.array(z.string()),
  focusMessageIds: z.array(z.string()),
  targetParticipantId: z.string().nullable(),
  categories: z.array(z.string()),
  assessment: z.enum(ASSESSMENTS),
  findings: z.array(
    z.object({
      messageId: z.string(),
      cue,
      targetId: z.string().nullable(),
      modifier: z.enum(MODIFIERS),
      confidence: z.enum(CONFIDENCES),
      rationale: z.string(),
      verification: z.string().nullable().optional(),
    }),
  ),
  patterns: z.array(z.object({ type: z.string(), messageIds: z.array(z.string()), summary: z.string() })),
  explanation: z.string(),
  uncertainReason: z.string().nullable(),
  roberta: z.array(
    z.object({
      messageId: z.string(),
      model: z.string(),
      notBullying: z.number(),
      bullying: z.number(),
      predicted: z.enum(['bullying', 'not_bullying']),
      latencyMs: z.number(),
    }),
  ),
  fusion: z.array(z.object({ messageId: z.string(), cue, agreement, status: evStatus, p: z.number(), sources: z.array(z.string()), note: z.string() })),
  touchedEvidence: z.array(z.string()),
  supersededEvidence: z.array(z.string()),
  latency: z.object({ totalMs: z.number(), robertaMs: z.number().nullable(), contextualMs: z.number().nullable() }),
  contextStats: z.object({ messages: z.number(), relatedEvidence: z.number(), approxTokens: z.number(), truncated: z.boolean() }),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  warnings: z.array(z.string()),
  stale: z.boolean(),
  createdAt: z.string(),
});

export const AnalyzeResponseSchema = z.object({
  result: AnalysisResultSchema.passthrough(),
  evidence: z.array(EvidenceEventSchema).nullable(),
  firstSeen: z.record(z.number()).nullable(),
});

export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
