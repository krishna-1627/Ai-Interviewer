import fs from 'fs';
import { callAzureOpenAI } from '../../utils/azureOpenAI.js';

/**
 * Evaluates the candidate's answer against the active question's rubric.
 * @param {string} candidateTranscript - The candidate's spoken answer.
 * @param {object} activeQuestion - The current question object (with rubricKeyphrases).
 * @param {string} language - The interview language.
 * @param {string} sessionId - Active session ID.
 * @returns {Promise<object>} The evaluation result { keyphraseResults, coveragePercent, holisticConceptualScore, reasoningSummary }
 */
export async function evaluateAnswer(candidateTranscript, activeQuestion, language, sessionId) {
  const rubricText = Array.isArray(activeQuestion?.rubricKeyphrases)
    ? activeQuestion.rubricKeyphrases.join(', ')
    : activeQuestion?.rubricKeyphrases || activeQuestion?.rubric_keyphrases || '';

  const questionText = typeof activeQuestion?.question === 'object'
    ? (activeQuestion.question[language] || activeQuestion.question['en'] || '')
    : (activeQuestion?.question || activeQuestion?.title || '');

  let _promptTemplate = null;
  function getPromptTemplate() {
    if (!_promptTemplate) {
      try {
        const promptPath = new URL('../../prompts/evaluator_prompt.md', import.meta.url).pathname;
        const normalizedPath = process.platform === 'win32' ? promptPath.substring(1) : promptPath;
        _promptTemplate = fs.readFileSync(normalizedPath, 'utf-8');
      } catch (e) {
        console.error('[EvaluatorAgent] Failed to load prompt:', e);
        _promptTemplate = '';
      }
    }
    return _promptTemplate;
  }

  const systemInstruction = getPromptTemplate()
    .replace('{{QUESTION_TEXT}}', questionText)
    .replace('{{RUBRIC_TEXT}}', rubricText);

  const userInstruction = `CANDIDATE ANSWER:
"${candidateTranscript}"`;

  console.log(`[Evaluator] Grading transcript with Azure OpenAI gpt-4o-mini...`);

  let response;
  try {
    response = await callAzureOpenAI({
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userInstruction }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      sessionId,
    });
  } catch (err) {
    console.error(`[Evaluator] Azure OpenAI error: ${err.message}`);
    response = { choices: [{ message: { content: '{}' } }] };
  }

  const rawJson = response.choices[0]?.message?.content || '{}';
  let evaluation;
  try {
    evaluation = JSON.parse(rawJson);
  } catch (e) {
    console.error(`[Evaluator] Failed to parse JSON: ${rawJson}`);
    evaluation = { keyphraseResults: [], holisticConceptualScore: 0, reasoningSummary: '' };
  }

  let results = evaluation.keyphraseResults || [];
  
  // GUARANTEE: Ensure every rubric keyphrase is accounted for.
  // If the LLM omitted it or JSON parsing failed entirely, mark it 'missed'.
  const expectedKeyphrases = Array.isArray(activeQuestion?.rubricKeyphrases)
    ? activeQuestion.rubricKeyphrases
    : (activeQuestion?.rubric_keyphrases || []);
    
  for (const expected of expectedKeyphrases) {
    if (!results.some(r => r.keyphrase.toLowerCase() === expected.toLowerCase())) {
      results.push({ keyphrase: expected, status: 'missed', evidenceQuote: null });
    }
  }

  // Calculate raw keyphrase score
  let hits = 0;
  let partials = 0;
  
  for (const item of results) {
    if (item.status === 'hit') hits++;
    if (item.status === 'partial') partials++;
  }

  const total = results.length;
  const keyphraseScore = total > 0 ? ((hits + 0.5 * partials) / total) * 100 : 0;

  // Holistic Conceptual Score: evaluates analogies, mental models, & valid alternative architectures
  const holisticScore = typeof evaluation.holisticConceptualScore === 'number'
    ? Math.max(0, Math.min(100, evaluation.holisticConceptualScore))
    : keyphraseScore;

  // HYBRID SCORE FORMULA:
  // 40% keyword presence + 60% holistic conceptual mastery
  let blendedScore = (0.4 * keyphraseScore) + (0.6 * holisticScore);

  // If candidate showed strong conceptual mastery (>= 75) via alternative valid pattern / analogy,
  // ensure they are not unfairly penalized by missing exact buzzwords.
  if (holisticScore >= 75 && blendedScore < 70) {
    blendedScore = Math.max(blendedScore, holisticScore * 0.9);
  }

  const coveragePercent = Math.round(Math.min(100, Math.max(0, blendedScore)));

  console.log(`[Evaluator] Evaluated -> Keyphrase Score: ${Math.round(keyphraseScore)}%, Holistic Score: ${Math.round(holisticScore)}%, Final Coverage: ${coveragePercent}%`);

  return {
    keyphraseResults: results,
    coveragePercent,
    holisticConceptualScore: Math.round(holisticScore),
    reasoningSummary: evaluation.reasoningSummary || '',
  };
}
