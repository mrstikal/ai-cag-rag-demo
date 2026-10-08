import fs from "node:fs/promises";
import path from "node:path";
import { config, ROOT_DIR } from "./config";
import { answerQuestion, checkCitations } from "./generation";

export interface GenQuestion {
  id: string;
  question: string;
  answerable: boolean;
  expectedFacts?: string[];
  expectedSources?: string[];
}

export interface GenFile {
  description?: string;
  questions: GenQuestion[];
}

export interface GenOutcome {
  id: string;
  question: string;
  answerable: boolean;
  status: string;
  answer: string;
  citations: string[];
  citedDocuments: string[];
  expectedSources: string[];
  expectedSourceHit: boolean | null;
  expectedFacts: string[];
  matchedFacts: string[];
  factsOk: boolean | null;
  citationValid: boolean;
  error?: string;
}

export interface GenMetrics {
  total: number;
  answerableTotal: number;
  answerableCorrect: number;
  unanswerableTotal: number;
  unanswerableCorrect: number;
  citationValid: number;
  expectedSourceHit: number;
  factsCorrect: number;
  errors: number;
}

export interface GenReport {
  file: string;
  model: string;
  generatedAt: string;
  metrics: GenMetrics;
  outcomes: GenOutcome[];
}

export const DEFAULT_GEN_FILE = path.join(ROOT_DIR, "eval", "generation.json");

export async function loadGenerationQuestions(file: string = DEFAULT_GEN_FILE): Promise<GenQuestion[]> {
  const raw = await fs.readFile(file, "utf8");
  const parsed = JSON.parse(raw) as GenFile;
  if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
    throw new Error(`No questions found in ${file}`);
  }
  return parsed.questions;
}

function computeMetrics(outcomes: GenOutcome[]): GenMetrics {
  const answerable = outcomes.filter((outcome) => outcome.answerable);
  const unanswerable = outcomes.filter((outcome) => !outcome.answerable);
  // "Answerable correct" requires an answered status, the expected source cited,
  // and the expected facts present.
  const answerableCorrect = answerable.filter(
    (outcome) => outcome.status === "answered" && outcome.expectedSourceHit === true && outcome.factsOk === true,
  ).length;
  return {
    total: outcomes.length,
    answerableTotal: answerable.length,
    answerableCorrect,
    unanswerableTotal: unanswerable.length,
    unanswerableCorrect: unanswerable.filter((outcome) => outcome.status === "insufficient").length,
    citationValid: outcomes.filter((outcome) => outcome.citationValid).length,
    expectedSourceHit: answerable.filter((outcome) => outcome.expectedSourceHit === true).length,
    factsCorrect: answerable.filter((outcome) => outcome.factsOk === true).length,
    errors: outcomes.filter((outcome) => outcome.status === "error").length,
  };
}

export async function runGenerationEval(file: string = DEFAULT_GEN_FILE): Promise<GenReport> {
  const questions = await loadGenerationQuestions(file);
  const outcomes: GenOutcome[] = [];

  for (const item of questions) {
    const expectedSources = item.expectedSources ?? [];
    const expectedFacts = item.expectedFacts ?? [];
    try {
      const result = await answerQuestion(item.question);
      const bySource = new Map(result.sources.map((source) => [source.sourceId, source.chunk.documentId]));
      const inlineMarkers = [...result.answer.matchAll(/\[([A-Za-z]{1,3}\d+)\]/g)].map((match) => match[1] ?? "");
      const referenced = [...new Set([...result.citations, ...inlineMarkers])];
      const citedDocuments = [
        ...new Set(referenced.map((citation) => bySource.get(citation)).filter((doc): doc is string => Boolean(doc))),
      ];
      const expectedSourceHit = item.answerable ? expectedSources.every((doc) => citedDocuments.includes(doc)) : null;
      const matchedFacts = expectedFacts.filter((fact) => result.answer.toLowerCase().includes(fact.toLowerCase()));
      const factsOk = item.answerable ? matchedFacts.length === expectedFacts.length : null;

      const citationValid = checkCitations(result, new Set(result.sources.map((source) => source.sourceId))) === null;

      outcomes.push({
        id: item.id,
        question: item.question,
        answerable: item.answerable,
        status: result.status,
        answer: result.answer,
        citations: result.citations,
        citedDocuments,
        expectedSources,
        expectedSourceHit,
        expectedFacts,
        matchedFacts,
        factsOk,
        citationValid,
      });
    } catch (error) {
      outcomes.push({
        id: item.id,
        question: item.question,
        answerable: item.answerable,
        status: "error",
        answer: "",
        citations: [],
        citedDocuments: [],
        expectedSources,
        expectedSourceHit: item.answerable ? false : null,
        expectedFacts,
        matchedFacts: [],
        factsOk: item.answerable ? false : null,
        citationValid: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    file,
    model: config.generation.model,
    generatedAt: new Date().toISOString(),
    metrics: computeMetrics(outcomes),
    outcomes,
  };
}
