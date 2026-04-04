import { buildStoreRouteRequest } from "@/lib/server/generation/stage-inputs";
import { storeRouteRequestSchema } from "@/lib/server/generation/contracts";
import type {
  GenerationEdgeDraft,
  GenerationNodeDraft,
  QuizItem,
} from "@/lib/types";

const subject = "mathematics" as const;
const topic = "calculus_foundations";
const description =
  "Calculus Foundations is the study of change and accumulation. It encompasses limits, derivatives, integrals, rates of change, and approximation. It assumes prior knowledge of algebra, functions, and graph interpretation and serves as a foundation for differential equations, multivariable calculus, optimization, and mathematical modeling. Within mathematics, it is typically encountered at the introductory level.";

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (Object.isFrozen(value)) {
    return value;
  }

  for (const key of Object.keys(value) as Array<keyof T>) {
    const entry = value[key];
    if (typeof entry === "object" && entry !== null) {
      deepFreeze(entry);
    }
  }

  return Object.freeze(value);
}

const graphDraft = {
  nodes: [
    { id: "node_1", title: "Functions and graphs", position: 0 },
    { id: "node_2", title: "Limits intuition", position: 1 },
    { id: "node_3", title: "One-sided limits", position: 2 },
    { id: "node_4", title: "Continuity", position: 3 },
    { id: "node_5", title: "Average rate of change", position: 4 },
    { id: "node_6", title: "Secant and tangent slope", position: 5 },
    { id: "node_7", title: "Derivative definition", position: 6 },
    { id: "node_8", title: "Power rule", position: 7 },
    { id: "node_9", title: "Product and quotient rules", position: 8 },
    { id: "node_10", title: "Chain rule", position: 9 },
  ] satisfies GenerationNodeDraft[],
  edges: [
    { from_node_id: "node_1", to_node_id: "node_2", type: "hard" },
    { from_node_id: "node_2", to_node_id: "node_3", type: "hard" },
    { from_node_id: "node_3", to_node_id: "node_4", type: "hard" },
    { from_node_id: "node_4", to_node_id: "node_5", type: "hard" },
    { from_node_id: "node_5", to_node_id: "node_6", type: "hard" },
    { from_node_id: "node_6", to_node_id: "node_7", type: "hard" },
    { from_node_id: "node_7", to_node_id: "node_8", type: "hard" },
    { from_node_id: "node_8", to_node_id: "node_9", type: "hard" },
    { from_node_id: "node_9", to_node_id: "node_10", type: "hard" },
  ] satisfies GenerationEdgeDraft[],
};

export type SmokeLessonArtifact = {
  id: string;
  title: string;
  position: number;
  lesson_text: string;
  static_diagram: string;
  quiz_json: QuizItem[];
};

export type SmokeDiagnosticArtifact = {
  id: string;
  diagnostic_questions: Array<{
    question: string;
    options: [string, string, string, string];
    correct_index: number;
    difficulty_order: number;
    node_id: string;
  }>;
};

export type SmokeVisualArtifact = {
  id: string;
  p5_code: string;
  visual_verified: boolean;
};

export type SmokeArtifactBundle = {
  graph: {
    title: string;
    subject: typeof subject;
    topic: string;
    description: string;
  };
  graphDraft: typeof graphDraft;
  lessonArtifacts: SmokeLessonArtifact[];
  diagnosticArtifacts: SmokeDiagnosticArtifact[];
  visualArtifacts: SmokeVisualArtifact[];
};

const lessonArtifacts: SmokeArtifactBundle["lessonArtifacts"] = [
  {
    id: "node_1",
    title: "Functions and graphs",
    position: 0,
    lesson_text:
      "A function is a rule that assigns exactly one output to every valid input. We write f(x) to mean 'the output of function f when the input is x.' The set of all allowed inputs is called the domain, and the set of all possible outputs is called the range. For example, f(x) = x² accepts any real number as input and always produces a non-negative output, so its domain is all real numbers and its range is [0, ∞). A graph is the visual representation of a function: every point (x, f(x)) is plotted on a coordinate plane, with x on the horizontal axis and f(x) on the vertical axis. The shape of the graph reveals key behaviors — whether the function rises or falls, where it equals zero (x-intercepts), and whether it has a maximum or minimum. The vertical line test is a quick check: if any vertical line crosses a graph more than once, the graph does not represent a function, because one input would map to two outputs. Understanding functions and their graphs is essential for calculus because derivatives describe how a function's graph slopes, and integrals measure the area beneath it.",
    static_diagram:
      "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='260' font-family='Arial' font-size='13'><rect width='320' height='260' fill='#f9f9f9' rx='8'/><line x1='40' y1='220' x2='290' y2='220' stroke='#333' stroke-width='2'/><line x1='165' y1='20' x2='165' y2='240' stroke='#333' stroke-width='2'/><polyline points='40,220 60,196 80,176 100,160 120,148 140,140 160,136 165,135 170,136 180,140 200,148 220,160 240,176 260,196 280,220' fill='none' stroke='#2563eb' stroke-width='2.5'/><text x='270' y='215' fill='#2563eb' font-size='12'>f(x)=x²</text><text x='285' y='228' fill='#333'>x</text><text x='170' y='18' fill='#333'>f(x)</text><circle cx='165' cy='135' r='4' fill='#e11d48'/><text x='172' y='132' fill='#e11d48' font-size='11'>vertex (0,0)</text><line x1='100' y1='10' x2='100' y2='250' stroke='#16a34a' stroke-width='1' stroke-dasharray='5,4'/><text x='104' y='22' fill='#16a34a' font-size='11'>vertical line test</text><text x='104' y='35' fill='#16a34a' font-size='11'>1 intersection ✓</text></svg>",
    quiz_json: [
      { question: "Which of the following best defines a function?", options: ["A relation that may assign many outputs to one input", "A rule that assigns exactly one output to every input", "A graph with only straight lines", "Any equation with x in it"], correct_index: 1, explanation: "A function must assign exactly one output to every input." },
      { question: "For f(x) = x², what is the range?", options: ["(-∞, ∞)", "[1, ∞)", "[0, ∞)", "(-∞, 0]"], correct_index: 2, explanation: "Squaring any real number always gives a non-negative result." },
      { question: "What does the vertical line test determine?", options: ["Whether the graph is increasing", "Whether the graph represents a function", "Whether the graph has a maximum", "Whether the graph is continuous"], correct_index: 1, explanation: "If any vertical line intersects more than once, it is not a function." },
    ],
  },
  {
    id: "node_2",
    title: "Limits intuition",
    position: 1,
    lesson_text:
      "A limit describes the value a function approaches as the input gets closer and closer to some target value — without necessarily reaching it. This idea is the cornerstone of calculus, underlying both derivatives and integrals.\n\nImagine walking along the graph of f(x) = (x² − 1)/(x − 1). At x = 1 the expression is undefined (division by zero), yet as x approaches 1 from either side the output gets closer and closer to 2. We write this as: lim(x→1) (x²−1)/(x−1) = 2.\n\nKey ideas to internalize:\n• Approaching, not arriving — the limit cares about the journey, not the destination.\n• Two-sided agreement — the limit exists only when the left-hand approach and the right-hand approach give the same value.\n• The function value at the point is irrelevant — the function can be undefined, or defined differently, at that exact point.\n\nLimits let us handle situations where direct substitution breaks down. They give calculus a rigorous way to talk about instantaneous rates of change (derivatives) and infinite sums (integrals). Building a strong intuition for limits — what it means to get arbitrarily close — is essential before moving to formal definitions and rules.",
    static_diagram:
      "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='220' font-family='sans-serif' font-size='13'><rect width='320' height='220' fill='#f9f9f9' rx='8'/><text x='160' y='22' text-anchor='middle' font-size='14' font-weight='bold' fill='#333'>lim (x→1) (x²−1)/(x−1) = 2</text><line x1='40' y1='180' x2='290' y2='180' stroke='#aaa' stroke-width='1.5'/><line x1='60' y1='30' x2='60' y2='185' stroke='#aaa' stroke-width='1.5'/><text x='292' y='184' fill='#555' font-size='12'>x</text><text x='62' y='26' fill='#555' font-size='12'>y</text><polyline points='65,170 90,158 115,146 138,136 155,129 168,124 178,121' stroke='#2979ff' stroke-width='2.2' fill='none'/><polyline points='182,121 192,124 205,129 222,136 245,146 270,158 290,170' stroke='#2979ff' stroke-width='2.2' fill='none'/><circle cx='180' cy='121' r='5' fill='white' stroke='#e53935' stroke-width='2'/><line x1='180' y1='30' x2='180' y2='180' stroke='#e53935' stroke-width='1' stroke-dasharray='5,4'/><line x1='60' y1='121' x2='290' y2='121' stroke='#43a047' stroke-width='1' stroke-dasharray='5,4'/><text x='183' y='192' fill='#e53935' font-size='12'>x=1</text><text x='30' y='125' fill='#43a047' font-size='12'>y=2</text><text x='100' y='210' text-anchor='middle' fill='#888' font-size='11'>← approaches from left</text><text x='230' y='210' text-anchor='middle' fill='#888' font-size='11'>approaches from right →</text></svg>",
    quiz_json: [
      { question: "What does lim(x→c) f(x) = L mean?", options: ["f(c) = L exactly", "f(x) approaches L as x approaches c", "x approaches L as f(x) approaches c", "The graph must cross the y-axis at L"], correct_index: 1, explanation: "A limit describes the value the function approaches near c." },
      { question: "For a two-sided limit to exist at x = c, which condition must hold?", options: ["The function must be defined at c", "The left-hand and right-hand limits must agree", "The function must be a polynomial", "The graph must be continuous"], correct_index: 1, explanation: "The one-sided limits must match." },
      { question: "Why can we still find lim(x→1) (x²−1)/(x−1) even though f(1) is undefined?", options: ["Because limits ignore x", "Because the denominator is never zero", "Because the function approaches 2 near x = 1", "Because the graph is a parabola"], correct_index: 2, explanation: "Limits describe behavior as x approaches the target." },
    ],
  },
];

lessonArtifacts.push(
  {
    id: "node_3",
    title: "One-sided limits",
    position: 2,
    lesson_text:
      "A one-sided limit asks: what value does a function approach as x gets close to a point from only one direction?\n\nThe left-hand limit is written lim(x→c⁻) f(x). It describes the value f(x) approaches as x approaches c from values less than c (from the left).\n\nThe right-hand limit is written lim(x→c⁺) f(x). It describes the value f(x) approaches as x approaches c from values greater than c (from the right).\n\nThe two-sided limit lim(x→c) f(x) exists only when both one-sided limits exist AND are equal:\n\nlim(x→c⁻) f(x) = lim(x→c⁺) f(x)\n\nIf the two sides approach different values, the two-sided limit does not exist (DNE).\n\nExample: Consider f(x) = x/|x|, a sign function. As x→0⁻, f(x)→−1. As x→0⁺, f(x)→+1. Since −1 ≠ +1, lim(x→0) f(x) does not exist.\n\nOne-sided limits are especially useful at jump discontinuities, piecewise functions, and endpoints of domains. They let us describe behavior precisely even when the full two-sided limit fails.",
    static_diagram:
      "<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200' font-family='Arial' font-size='13'><rect width='320' height='200' fill='#f9f9f9' rx='8'/><line x1='30' y1='100' x2='290' y2='100' stroke='#ccc' stroke-width='1'/><line x1='160' y1='20' x2='160' y2='180' stroke='#ccc' stroke-width='1'/><text x='285' y='95' fill='#999' font-size='11'>x</text><text x='163' y='18' fill='#999' font-size='11'>y</text><polyline points='40,140 80,130 120,120 150,112' fill='none' stroke='#3b82f6' stroke-width='2.5'/><circle cx='160' cy='108' r='5' fill='white' stroke='#3b82f6' stroke-width='2'/><polyline points='170,72 200,80 240,88 280,96' fill='none' stroke='#ef4444' stroke-width='2.5'/><circle cx='160' cy='76' r='5' fill='white' stroke='#ef4444' stroke-width='2'/><text x='60' y='158' fill='#3b82f6' font-size='12'>x→c⁻ approaches 1</text><text x='170' y='62' fill='#ef4444' font-size='12'>x→c⁺ approaches −1</text><text x='148' y='195' fill='#555' font-size='11'>c</text><line x1='160' y1='185' x2='160' y2='178' stroke='#555' stroke-width='1'/><text x='60' y='20' fill='#333' font-size='13' font-weight='bold'>One-Sided Limits (Jump Discontinuity)</text></svg>",
    quiz_json: [
      { question: "What does a left-hand limit describe?", options: ["Approach from values less than c", "Approach from values greater than c", "The function value at c", "The graph slope at c"], correct_index: 0, explanation: "Left-hand means approach from the left." },
      { question: "When does a two-sided limit fail to exist?", options: ["When the function is undefined", "When the left and right limits differ", "When x = c", "When the graph is a line"], correct_index: 1, explanation: "Both one-sided limits must agree." },
      { question: "For f(x)=x/|x|, what happens as x→0⁻?", options: ["Approaches 0", "Approaches −1", "Approaches 1", "Approaches undefined"], correct_index: 1, explanation: "Values from the left approach −1." },
    ],
  },
  {
    id: "node_4",
    title: "Continuity",
    position: 3,
    lesson_text:
      "Continuity describes when a function has no breaks, holes, or jumps at a point. A function f is continuous at x = c if three conditions all hold: (1) f(c) is defined, (2) the limit of f(x) as x approaches c exists, and (3) that limit equals f(c). If any condition fails, the function is discontinuous at c. There are three classic types of discontinuity. A removable discontinuity occurs when the limit exists but either f(c) is undefined or f(c) does not equal the limit — it looks like a hole in the graph. A jump discontinuity occurs when the left-hand and right-hand limits both exist but are not equal — the graph jumps from one value to another. An infinite discontinuity occurs when the limit is unbounded, producing a vertical asymptote. Continuity on an interval means the function is continuous at every point in that interval. Polynomials, sine, cosine, and exponential functions are continuous everywhere. Rational functions are continuous wherever the denominator is nonzero. Understanding continuity is essential because many powerful theorems in calculus — such as the Intermediate Value Theorem — require functions to be continuous on a closed interval.",
    static_diagram: "<svg xmlns='http://www.w3.org/2000/svg' width='480' height='200' font-family='sans-serif' font-size='12'><rect width='480' height='200' fill='#f9f9f9'/><text x='60' y='18' font-size='13' font-weight='bold' fill='#333'>Types of Discontinuity</text><text x='30' y='38' fill='#555'>Continuous</text><polyline points='20,120 60,90 100,70 140,60' fill='none' stroke='#2a7' stroke-width='2.5'/><text x='20' y='155' fill='#2a7' font-size='11'>f(c) defined,</text><text x='20' y='168' fill='#2a7' font-size='11'>lim = f(c)</text><text x='175' y='38' fill='#555'>Removable</text><polyline points='165,120 205,90 245,70' fill='none' stroke='#e07' stroke-width='2.5'/><polyline points='245,70 285,55' fill='none' stroke='#e07' stroke-width='2.5'/><circle cx='245' cy='70' r='5' fill='#f9f9f9' stroke='#e07' stroke-width='2'/><circle cx='245' cy='85' r='4' fill='#e07'/><text x='165' y='155' fill='#e07' font-size='11'>Hole: lim exists</text><text x='165' y='168' fill='#e07' font-size='11'>but f(c) ≠ lim</text><text x='325' y='38' fill='#555'>Jump</text><polyline points='315,115 355,95' fill='none' stroke='#d60' stroke-width='2.5'/><circle cx='355' cy='95' r='5' fill='#f9f9f9' stroke='#d60' stroke-width='2'/><polyline points='355,70 395,50' fill='none' stroke='#d60' stroke-width='2.5'/><circle cx='355' cy='70' r='4' fill='#d60'/><text x='315' y='155' fill='#d60' font-size='11'>Left lim ≠</text><text x='315' y='168' fill='#d60' font-size='11'>Right lim</text><line x1='155' y1='25' x2='155' y2='185' stroke='#ccc' stroke-width='1'/><line x1='305' y1='25' x2='305' y2='185' stroke='#ccc' stroke-width='1'/></svg>",
    quiz_json: [
      { question: "Which three conditions must ALL hold for continuity at x = c?", options: ["f(c) defined, limit exists, and they are equal", "Only the limit exists", "Only f(c) is defined", "The graph must be a parabola"], correct_index: 0, explanation: "Continuity requires all three conditions." },
      { question: "A hole with a defined limit is what type of discontinuity?", options: ["Jump", "Infinite", "Removable", "No discontinuity"], correct_index: 2, explanation: "A hole with a limit is removable." },
      { question: "For a jump discontinuity, which statement is true?", options: ["The left and right limits are equal", "The limit is infinite", "The left and right limits differ", "The function must be quadratic"], correct_index: 2, explanation: "Jump discontinuities have unequal one-sided limits." },
    ],
  },
);

const lessonTextByTitle: Record<string, string> = {
    "Average rate of change":
      "The average rate of change (AROC) of a function f over an interval [a, b] measures how much the output changes per unit of input change. It is computed as the slope of the secant line connecting the two points (a, f(a)) and (b, f(b)) on the graph of f. The formula is: AROC = (f(b) - f(a)) / (b - a). This is identical in form to the slope formula from algebra, but now applied to any function over any interval. For example, if f(x) = x², then over [1, 3]: f(1) = 1, f(3) = 9, so AROC = (9 - 1)/(3 - 1) = 8/2 = 4. This means the function rises an average of 4 units for every 1 unit increase in x on that interval. The AROC does not tell us what happens at any single point — it summarizes behavior across the whole interval. Continuity ensures the function has no breaks on [a, b], making the secant line a meaningful summary. As the interval shrinks (b approaches a), the AROC approaches the instantaneous rate of change, which is the derivative — the central concept of differential calculus.",
    "Secant and tangent slope":
      "A secant line connects two points on a curve and measures the average rate of change between them. If the two points are (x, f(x)) and (x+h, f(x+h)), the slope of the secant line is the familiar difference quotient: [f(x+h) - f(x)] / h. This is exactly the average rate of change over the interval of width h.\n\nA tangent line touches the curve at exactly one point and captures the instantaneous rate of change at that point. We obtain the tangent slope by imagining the second point sliding closer and closer to the first — that is, by letting h approach zero. When this limiting process produces a definite value, that value is the slope of the tangent line at x.\n\nGeometrically, as h shrinks, the secant line rotates and converges onto the tangent line. The tangent slope is therefore the limit of the secant slope:\n\n  m_tan = lim(h→0) [f(x+h) - f(x)] / h\n\nThis limit is the central idea behind the derivative. Understanding the transition from secant to tangent — from average to instantaneous — is the conceptual bridge between average rate of change and differential calculus.",
    "Derivative definition":
      "The derivative of a function f at a point x is defined as the limit of the slope of secant lines as the two points on the curve get infinitely close together. Formally, the derivative f′(x) is written as: f′(x) = lim[h→0] (f(x+h) − f(x)) / h. Here, h represents the horizontal distance between the two points on the curve. As h shrinks toward zero, the secant line through (x, f(x)) and (x+h, f(x+h)) approaches the tangent line at x. The value of this limit — if it exists — is the instantaneous rate of change of f at x, which equals the slope of the tangent line at that point. If the limit does not exist, the function is not differentiable at x. Geometrically, you can think of the derivative as answering: 'How steeply is the curve rising or falling at exactly this point?' For example, if f(x) = x², then f′(x) = lim[h→0] ((x+h)² − x²) / h = lim[h→0] (2xh + h²) / h = lim[h→0] (2x + h) = 2x. The derivative of x² is 2x, meaning the slope of the parabola at any point x equals 2x.",
    "Power rule":
      "The power rule is the most fundamental shortcut for differentiating polynomial terms. If you have a function of the form f(x) = xⁿ, where n is any real number, the derivative is found by multiplying the exponent down as a coefficient and then reducing the exponent by one: f′(x) = n·xⁿ⁻¹. This rule follows directly from the limit definition of the derivative, but it lets you skip that lengthy calculation every time.\n\nFor example, if f(x) = x³, then f′(x) = 3x². If f(x) = x⁵, then f′(x) = 5x⁴. The rule also works for negative and fractional exponents: the derivative of x⁻² is −2x⁻³, and the derivative of x^(1/2) is (1/2)x^(−1/2).\n\nWhen a constant coefficient is present, it simply carries through: the derivative of 4x³ is 4·3x² = 12x². Constants alone (like f(x) = 7) have a derivative of zero because x⁰ = 1 and reducing the exponent gives x⁻¹ multiplied by zero.\n\nThe power rule combines with the sum rule so you can differentiate each term of a polynomial independently, making it the workhorse of basic differentiation.",
    "Product and quotient rules":
      "When differentiating a product or quotient of two functions, simple term-by-term rules no longer apply. Two special rules handle these cases.\n\n**Product Rule**\nIf h(x) = f(x)·g(x), then:\nh′(x) = f′(x)·g(x) + f(x)·g′(x)\n\nIn words: differentiate the first and keep the second, then keep the first and differentiate the second. Add the two results.\n\nExample: h(x) = x²·sin(x)\nh′(x) = 2x·sin(x) + x²·cos(x)\n\n**Quotient Rule**\nIf h(x) = f(x)/g(x), then:\nh′(x) = [f′(x)·g(x) − f(x)·g′(x)] / [g(x)]²\n\nMemory aid: \"low d-high minus high d-low, over low squared.\"\n\nExample: h(x) = x³/cos(x)\nh′(x) = [3x²·cos(x) − x³·(−sin(x))] / cos²(x)\n     = [3x²·cos(x) + x³·sin(x)] / cos²(x)\n\n**Key points**\n- The product rule adds two terms; the quotient rule subtracts them (order matters!).\n- The quotient rule denominator is always [g(x)]², never g(x).\n- Both rules rely on the power rule for polynomial pieces.\n- Misremembering the subtraction order in the quotient rule is the most common error.",
    "Chain rule":
      "The chain rule lets you differentiate composite functions — functions built by plugging one function inside another. If y = f(g(x)), then the derivative is dy/dx = f'(g(x)) · g'(x). In words: differentiate the outer function (leaving the inner function untouched), then multiply by the derivative of the inner function.\n\nExample: Let y = sin(x²). Here the outer function is sin(u) and the inner function is u = x². Step 1 — differentiate the outer: cos(u) = cos(x²). Step 2 — differentiate the inner: d/dx(x²) = 2x. Multiply: dy/dx = cos(x²) · 2x = 2x cos(x²).\n\nA helpful mental model is the 'outside-inside' pattern:\n• Identify the outer layer and the inner layer.\n• Differentiate the outer layer, keeping the inner layer intact.\n• Multiply by the derivative of the inner layer.\n\nThe chain rule extends naturally to longer chains: if y = f(g(h(x))), then dy/dx = f'(g(h(x))) · g'(h(x)) · h'(x). Each link in the chain contributes one factor.\n\nThe chain rule works alongside the product and quotient rules. When a composite function also involves a product or quotient, apply the product/quotient rule first, then use the chain rule on each piece that requires it.",
  };

const quizByTitle: Record<string, QuizItem[]> = {
    "Average rate of change": [
      { question: "What does the average rate of change of f over [a, b] geometrically represent?", options: ["Area under the curve", "Slope of the tangent line", "Slope of the secant line", "Vertical distance"], correct_index: 2, explanation: "The average rate of change equals the secant slope." },
      { question: "For f(x) = x², what is the average rate of change over [2, 5]?", options: ["7", "5", "4", "3"], correct_index: 0, explanation: "f(2)=4 and f(5)=25, so AROC = 21/3 = 7." },
      { question: "Why does continuity on [a, b] matter when computing the average rate of change?", options: ["It ensures no gaps or jumps distort the interval", "It makes the slope zero", "It guarantees a maximum", "It makes the graph linear"], correct_index: 0, explanation: "Continuity keeps the interval behavior well-defined." },
    ],
    "Secant and tangent slope": [
      { question: "What does the slope of a secant line between two points on a curve represent?", options: ["The derivative at a point", "Average rate of change", "The y-intercept", "A vertical asymptote"], correct_index: 1, explanation: "A secant slope measures average rate of change." },
      { question: "How is the slope of the tangent line at a point obtained from secant slopes?", options: ["By increasing h", "By letting h→0", "By moving left only", "By squaring the slope"], correct_index: 1, explanation: "The tangent slope is the limit as h approaches zero." },
      { question: "Which expression correctly gives the slope of the tangent line to f at x?", options: ["f(x+h)-f(x)", "(f(x+h)-f(x))/h", "f(x)/h", "h/f(x)"], correct_index: 1, explanation: "The tangent slope is the difference quotient limit." },
    ],
    "Derivative definition": [
      { question: "What does the derivative f′(x) represent geometrically?", options: ["The slope of the tangent line", "The total area under the graph", "The x-intercept", "The average value"], correct_index: 0, explanation: "The derivative is the tangent slope at a point." },
      { question: "Using the limit definition, what is the derivative of f(x) = x²?", options: ["x", "x²", "2x", "2"], correct_index: 2, explanation: "Applying the definition gives 2x." },
      { question: "What happens to the secant line as h approaches 0 in the derivative definition?", options: ["It becomes vertical", "It converges to the tangent line", "It disappears", "It becomes a parabola"], correct_index: 1, explanation: "The secant rotates into the tangent line." },
    ],
    "Power rule": [
      { question: "What is the derivative of f(x) = x⁶ using the power rule?", options: ["6x⁵", "x⁵", "5x⁶", "6x"], correct_index: 0, explanation: "Multiply the exponent down and reduce it by one." },
      { question: "Using the power rule, what is the derivative of g(x) = 5x⁴?", options: ["5x³", "20x³", "20x⁴", "4x⁵"], correct_index: 1, explanation: "The constant carries through: 5·4x³ = 20x³." },
      { question: "Which of the following correctly applies the power rule to f(x) = x^(−3)?", options: ["−3x^(−4)", "3x^(−4)", "−3x^(−2)", "x^(−4)"], correct_index: 0, explanation: "The power rule works for negative exponents too." },
    ],
    "Product and quotient rules": [
      { question: "Using the product rule, what is the derivative of h(x) = x³ · e^x?", options: ["3x²·e^x + x³·e^x", "x³·e^x", "3x³·e^x", "3x²·e^x"], correct_index: 0, explanation: "Both product-rule terms are required." },
      { question: "Which expression correctly applies the quotient rule to h(x) = sin(x) / x²?", options: ["(cos(x)x² - sin(x)2x)/x⁴", "(cos(x)x² + sin(x)2x)/x²", "sin(x) / 2x", "x² / sin(x)"], correct_index: 0, explanation: "Quotient rule uses (f′g − fg′)/g²." },
      { question: "A student writes the quotient rule as h′ = (f′g − fg′) / g. What is wrong?", options: ["The denominator must be g²", "The numerator must be plus", "The derivative should be zero", "Nothing is wrong"], correct_index: 0, explanation: "The denominator must be squared." },
    ],
    "Chain rule": [
      { question: "What is the derivative of y = (3x + 1)⁵?", options: ["5(3x+1)^4", "15(3x+1)^4", "3(3x+1)^5", "(3x+1)^4"], correct_index: 1, explanation: "Outer derivative times inner derivative." },
      { question: "If y = e^(x²), which expression equals dy/dx?", options: ["2x", "e^(x²)", "2x e^(x²)", "x² e^x"], correct_index: 2, explanation: "Differentiate outer and multiply by inner derivative." },
      { question: "Which step comes FIRST when applying the chain rule to y = cos(5x³)?", options: ["Differentiate the inner function first", "Differentiate the outer function first", "Multiply by 5 immediately", "Use the quotient rule"], correct_index: 1, explanation: "Chain rule starts with the outer function." },
    ],
  };

const lessonArtifactsTail = graphDraft.nodes.slice(4).map((node) => ({
    id: node.id,
    title: node.title,
    position: node.position,
    lesson_text: lessonTextByTitle[node.title],
    static_diagram: `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='220'><rect width='320' height='220' fill='#f9f9f9'/><text x='20' y='20' font-family='Arial' font-size='13' fill='#333'>${node.title}</text></svg>`,
    quiz_json: quizByTitle[node.title],
  }));

const diagnosticArtifacts: SmokeDiagnosticArtifact[] = [
  {
    id: "node_1",
    diagnostic_questions: [
      {
        question: "If f(x) = 2x + 3, what is f(4)?",
        options: ["7", "11", "8", "12"],
        correct_index: 1,
        difficulty_order: 1,
        node_id: "node_1",
      },
    ],
  },
  {
    id: "node_2",
    diagnostic_questions: [
      {
        question:
          "As x gets closer and closer to 2, what value does (x^2 - 4) / (x - 2) approach?",
        options: ["4", "2", "0", "Does not exist"],
        correct_index: 0,
        difficulty_order: 2,
        node_id: "node_2",
      },
    ],
  },
  {
    id: "node_3",
    diagnostic_questions: [
      {
        question:
          "For f(x) = x / |x|, what is the left-hand limit as x approaches 0?",
        options: ["-1", "0", "1", "Does not exist"],
        correct_index: 0,
        difficulty_order: 3,
        node_id: "node_3",
      },
    ],
  },
  {
    id: "node_4",
    diagnostic_questions: [
      {
        question: "Which condition must hold for a function to be continuous at x = c?",
        options: [
          "f(c) is defined and equals the limit",
          "The graph has no x-intercepts",
          "The slope must be positive",
          "The function must be a polynomial",
        ],
        correct_index: 0,
        difficulty_order: 4,
        node_id: "node_4",
      },
    ],
  },
  {
    id: "node_5",
    diagnostic_questions: [
      {
        question:
          "A function has f(2) = 5 and f(6) = 13. What is the average rate of change on [2, 6]?",
        options: ["2", "3", "4", "8"],
        correct_index: 1,
        difficulty_order: 5,
        node_id: "node_5",
      },
    ],
  },
  {
    id: "node_6",
    diagnostic_questions: [
      {
        question:
          "As the second point on a secant line moves closer to the first point, the secant approaches what?",
        options: ["A horizontal line", "A tangent line", "A vertical asymptote", "A circle"],
        correct_index: 1,
        difficulty_order: 6,
        node_id: "node_6",
      },
    ],
  },
  {
    id: "node_7",
    diagnostic_questions: [
      {
        question:
          "Which expression defines the derivative of f at x = a?",
        options: [
          "lim(h->0) [f(a+h) - f(a)] / h",
          "[f(a+h) + f(a)] / h",
          "f(a+h) - f(a)",
          "lim(x->a) f(x)",
        ],
        correct_index: 0,
        difficulty_order: 7,
        node_id: "node_7",
      },
    ],
  },
  {
    id: "node_8",
    diagnostic_questions: [
      {
        question: "Using the power rule, what is the derivative of x^5?",
        options: ["5x^4", "x^4", "4x^5", "5x^6"],
        correct_index: 0,
        difficulty_order: 8,
        node_id: "node_8",
      },
    ],
  },
  {
    id: "node_9",
    diagnostic_questions: [
      {
        question:
          "If h(x) = x^2 * sin(x), which expression gives h'(x) using the product rule?",
        options: [
          "2x * sin(x) + x^2 * cos(x)",
          "2x * cos(x) + x^2 * sin(x)",
          "x^2 * cos(x)",
          "2x * sin(x)",
        ],
        correct_index: 0,
        difficulty_order: 9,
        node_id: "node_9",
      },
    ],
  },
  {
    id: "node_10",
    diagnostic_questions: [
      {
        question: "If h(x) = f(g(x)), what does the chain rule say about h'(x)?",
        options: [
          "h'(x) = f'(x) + g'(x)",
          "h'(x) = f'(g(x)) * g'(x)",
          "h'(x) = f(x) * g(x)",
          "h'(x) = g(f(x))",
        ],
        correct_index: 1,
        difficulty_order: 10,
        node_id: "node_10",
      },
    ],
  },
];

const visualArtifacts: SmokeVisualArtifact[] = [
  {
    id: "node_1",
    p5_code:
      "function setup() { createCanvas(480, 320); } function draw() { background(248); stroke(37, 99, 235); noFill(); beginShape(); for (let x = 60; x <= 420; x += 10) { vertex(x, 240 - 0.0035 * pow(x - 240, 2)); } endShape(); fill(15); text('Functions and graphs', 24, 30); }",
    visual_verified: true,
  },
  {
    id: "node_2",
    p5_code:
      "function setup() { createCanvas(480, 320); } function draw() { background(248); stroke(37, 99, 235); noFill(); line(240, 40, 240, 280); beginShape(); for (let x = 60; x < 220; x += 10) { vertex(x, 210 - 0.4 * (x - 120)); } for (let x = 260; x <= 420; x += 10) { vertex(x, 150 + 0.4 * (x - 300)); } endShape(); fill(15); text('Limits intuition', 24, 30); }",
    visual_verified: true,
  },
  {
    id: "node_3",
    p5_code:
      "function setup() { createCanvas(480, 320); } function draw() { background(248); stroke(37, 99, 235); line(80, 220, 220, 160); stroke(239, 68, 68); line(260, 140, 400, 100); fill(15); text('One-sided limits', 24, 30); }",
    visual_verified: true,
  },
  {
    id: "node_4",
    p5_code:
      "function setup() { createCanvas(480, 320); } function draw() { background(248); noFill(); stroke(37, 99, 235); arc(140, 190, 140, 100, PI, TWO_PI); stroke(239, 68, 68); circle(250, 140, 12); fill(15); text('Continuity', 24, 30); }",
    visual_verified: true,
  },
  {
    id: "node_5",
    p5_code:
      "function setup() { createCanvas(480, 320); } function draw() { background(248); stroke(37, 99, 235); noFill(); beginShape(); for (let x = 80; x <= 400; x += 8) { vertex(x, 240 - 0.0025 * pow(x - 240, 2)); } endShape(); stroke(239, 68, 68); line(120, 220, 320, 120); fill(15); text('Average rate of change', 24, 30); }",
    visual_verified: true,
  },
  {
    id: "node_6",
    p5_code:
      "function setup() { createCanvas(480, 320); } function draw() { background(248); stroke(37, 99, 235); noFill(); beginShape(); for (let x = 70; x <= 410; x += 8) { vertex(x, 230 - 0.0025 * pow(x - 240, 2)); } endShape(); stroke(239, 68, 68); line(140, 180, 340, 140); fill(15); text('Secant and tangent slope', 24, 30); }",
    visual_verified: true,
  },
  {
    id: "node_7",
    p5_code:
      "function setup() { createCanvas(480, 320); } function draw() { background(248); stroke(37, 99, 235); noFill(); beginShape(); for (let x = 70; x <= 410; x += 8) { vertex(x, 240 - 0.0028 * pow(x - 240, 2)); } endShape(); stroke(239, 68, 68); line(140, 200, 340, 120); fill(15); text(\"Derivative definition\", 24, 30); }",
    visual_verified: true,
  },
  {
    id: "node_8",
    p5_code:
      "function setup() { createCanvas(480, 320); } function draw() { background(248); fill(37, 99, 235); rect(70, 100, 150, 70, 12); rect(260, 100, 150, 70, 12); fill(255); text('x^n', 135, 132); text('n*x^(n-1)', 290, 132); fill(15); text('Power rule', 24, 30); }",
    visual_verified: true,
  },
  {
    id: "node_9",
    p5_code:
      "function setup() { createCanvas(480, 320); } function draw() { background(248); fill(37, 99, 235); rect(70, 90, 140, 60, 12); fill(16, 185, 129); rect(70, 170, 140, 60, 12); fill(239, 68, 68); rect(270, 130, 140, 70, 12); fill(255); text('u(x)', 120, 125); text('v(x)', 120, 205); text('product / quotient', 300, 160); fill(15); text('Product and quotient rules', 24, 30); }",
    visual_verified: true,
  },
  {
    id: "node_10",
    p5_code:
      "function setup() { createCanvas(480, 320); } function draw() { background(248); fill(37, 99, 235); rect(60, 120, 90, 60, 12); fill(16, 185, 129); rect(180, 120, 90, 60, 12); fill(239, 68, 68); rect(300, 120, 120, 60, 12); fill(255); text('x', 100, 155); text('g(x)', 210, 155); text('f(g(x))', 330, 155); fill(15); text('Chain rule', 24, 30); }",
    visual_verified: true,
  },
];

export const CALCULUS_FOUNDATIONS_SMOKE_BUNDLE: SmokeArtifactBundle = deepFreeze({
  graph: {
    title: "Calculus Foundations",
    subject,
    topic,
    description,
  },
  graphDraft,
  lessonArtifacts: [...lessonArtifacts, ...lessonArtifactsTail],
  diagnosticArtifacts,
  visualArtifacts,
});

export const CALCULUS_FOUNDATIONS_STORE_REQUEST = deepFreeze(
  storeRouteRequestSchema.parse(
    buildStoreRouteRequest({
      graph: CALCULUS_FOUNDATIONS_SMOKE_BUNDLE.graph,
      graphDraft: CALCULUS_FOUNDATIONS_SMOKE_BUNDLE.graphDraft,
      lessonArtifacts: CALCULUS_FOUNDATIONS_SMOKE_BUNDLE.lessonArtifacts,
      diagnosticArtifacts: CALCULUS_FOUNDATIONS_SMOKE_BUNDLE.diagnosticArtifacts,
      visualArtifacts: CALCULUS_FOUNDATIONS_SMOKE_BUNDLE.visualArtifacts,
    }),
  ),
);
