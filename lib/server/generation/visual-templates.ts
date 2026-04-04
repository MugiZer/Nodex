import type { VisualNodeArtifact } from "./contracts";

type VisualTemplateInput = {
  subject: string;
  topic: string;
  node: {
    id: string;
    title: string;
    position: number;
  };
};

type VisualTemplate =
  | { kind: "function_graph"; variant: "basic" | "limits" | "continuity" }
  | { kind: "slope_explorer"; variant: "average_rate" | "derivative" | "power_rule" }
  | {
      kind: "trig_scene";
      variant: "unit_circle" | "triangle_ratio" | "wave" | "identity" | "equation";
    }
  | { kind: "transform_flow"; variant: "chain_rule" | "product_rule" | "quotient_rule" };

function quote(value: string): string {
  return JSON.stringify(value);
}

function sketch(lines: string[]): string {
  return lines.join("\n");
}

function normalizeVisualLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesExactNodeTitle(input: VisualTemplateInput, candidates: string[]): boolean {
  const title = normalizeVisualLabel(input.node.title);
  return candidates.some((candidate) => normalizeVisualLabel(candidate) === title);
}

type VisualFamilyKey =
  | "function_graph_basic"
  | "function_graph_limits"
  | "function_graph_continuity"
  | "slope_average_rate"
  | "slope_derivative"
  | "slope_power_rule"
  | "trig_unit_circle"
  | "trig_triangle_ratio"
  | "trig_wave"
  | "trig_identity"
  | "trig_equation"
  | "transform_chain_rule"
  | "transform_product_rule"
  | "transform_quotient_rule";

type VisualFamily = {
  key: VisualFamilyKey;
  template: VisualTemplate;
  matches: (input: VisualTemplateInput) => boolean;
};

type VisualVerificationPolicy = {
  allowedSubjects: string[];
  allowedTopics: string[];
};

function matchesNodeTitle(input: VisualTemplateInput, candidates: string[]): boolean {
  return matchesExactNodeTitle(input, candidates);
}

const VISUAL_FAMILY_REGISTRY: VisualFamily[] = [
  {
    key: "trig_unit_circle",
    template: { kind: "trig_scene", variant: "unit_circle" },
    matches: (input) =>
      matchesNodeTitle(input, [
        "Angle Measurement",
        "Unit Circle Basics",
        "Unit Circle Definition",
        "Radian Measure",
      ]),
  },
  {
    key: "trig_triangle_ratio",
    template: { kind: "trig_scene", variant: "triangle_ratio" },
    matches: (input) => matchesNodeTitle(input, ["Right Triangle Ratios"]),
  },
  {
    key: "trig_wave",
    template: { kind: "trig_scene", variant: "wave" },
    matches: (input) =>
      matchesNodeTitle(input, ["Sine Function", "Cosine Function", "Tangent Function"]),
  },
  {
    key: "trig_identity",
    template: { kind: "trig_scene", variant: "identity" },
    matches: (input) =>
      matchesNodeTitle(input, ["Pythagorean Identity", "Reciprocal Functions"]),
  },
  {
    key: "trig_equation",
    template: { kind: "trig_scene", variant: "equation" },
    matches: (input) =>
      matchesNodeTitle(input, ["Angle Addition Formulas", "Trig Equations"]),
  },
  {
    key: "transform_chain_rule",
    template: { kind: "transform_flow", variant: "chain_rule" },
    matches: (input) => matchesNodeTitle(input, ["Chain Rule"]),
  },
  {
    key: "transform_product_rule",
    template: { kind: "transform_flow", variant: "product_rule" },
    matches: (input) =>
      matchesNodeTitle(input, ["Product and Quotient Rules", "Product Rule"]),
  },
  {
    key: "transform_quotient_rule",
    template: { kind: "transform_flow", variant: "quotient_rule" },
    matches: (input) => matchesNodeTitle(input, ["Quotient Rule"]),
  },
  {
    key: "slope_power_rule",
    template: { kind: "slope_explorer", variant: "power_rule" },
    matches: (input) => matchesNodeTitle(input, ["Power Rule"]),
  },
  {
    key: "slope_average_rate",
    template: { kind: "slope_explorer", variant: "average_rate" },
    matches: (input) => matchesNodeTitle(input, ["Average Rate of Change"]),
  },
  {
    key: "slope_derivative",
    template: { kind: "slope_explorer", variant: "derivative" },
    matches: (input) =>
      matchesNodeTitle(input, ["Secant and Tangent Slope", "Derivative Definition"]),
  },
  {
    key: "function_graph_continuity",
    template: { kind: "function_graph", variant: "continuity" },
    matches: (input) => matchesNodeTitle(input, ["Continuity"]),
  },
  {
    key: "function_graph_limits",
    template: { kind: "function_graph", variant: "limits" },
    matches: (input) =>
      matchesNodeTitle(input, ["Limits Intuition", "One-Sided Limits"]),
  },
  {
    key: "function_graph_basic",
    template: { kind: "function_graph", variant: "basic" },
    matches: (input) =>
      matchesNodeTitle(input, ["Functions and Graphs", "Function Basics", "Graphs of Functions"]),
  },
];

const VISUAL_VERIFICATION_POLICIES: Record<VisualFamilyKey, VisualVerificationPolicy> = {
  trig_unit_circle: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["trigonometry"],
  },
  trig_triangle_ratio: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["trigonometry"],
  },
  trig_wave: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["trigonometry"],
  },
  trig_identity: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["trigonometry"],
  },
  trig_equation: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["trigonometry"],
  },
  transform_chain_rule: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["calculus_foundations"],
  },
  transform_product_rule: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["calculus_foundations"],
  },
  transform_quotient_rule: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["calculus_foundations"],
  },
  slope_power_rule: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["calculus_foundations"],
  },
  slope_average_rate: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["calculus_foundations"],
  },
  slope_derivative: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["calculus_foundations"],
  },
  function_graph_continuity: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["calculus_foundations"],
  },
  function_graph_limits: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["calculus_foundations"],
  },
  function_graph_basic: {
    allowedSubjects: ["mathematics"],
    allowedTopics: ["calculus_foundations"],
  },
};

function selectTemplate(input: VisualTemplateInput): VisualTemplate | null {
  for (const family of VISUAL_FAMILY_REGISTRY) {
    if (family.matches(input)) {
      return family.template;
    }
  }

  return null;
}

function buildBannerLines(title: string, subtitle: string): string[] {
  return [
    `  fill(15); textSize(21); text(${quote(title)}, 24, 34);`,
    `  fill(71); textSize(12); text(${quote(subtitle)}, 24, 56);`,
  ];
}

function buildFunctionGraphSketch(
  title: string,
  subtitle: string,
  variant: "basic" | "limits" | "continuity",
): string {
  const mode = quote(variant);
  return sketch([
    "function setup() {",
    "  createCanvas(480, 320);",
    "  textFont('Arial');",
    "}",
    "function draw() {",
    "  background(248);",
    "  drawGrid();",
    "  drawAxes();",
    "  drawCurve();",
    "  drawCursor();",
    ...buildBannerLines(title, subtitle),
    "  fill(15); textSize(12); text('Drag across the graph to inspect local behavior.', 24, 290);",
    "}",
    "function drawGrid() {",
    "  stroke(226); strokeWeight(1);",
    "  for (let x = 48; x <= width - 48; x += 24) { line(x, 64, x, height - 48); }",
    "  for (let y = 64; y <= height - 48; y += 24) { line(48, y, width - 48, y); }",
    "}",
    "function drawAxes() {",
    "  stroke(45); strokeWeight(2);",
    "  line(64, height / 2, width - 36, height / 2);",
    "  line(96, 52, 96, height - 40);",
    "  noStroke(); fill(92); textSize(11);",
    "  text('x', width - 38, height / 2 - 8);",
    "  text('y', 102, 62);",
    "}",
    "function drawCurve() {",
    `  const mode = ${mode};`,
    "  noFill(); stroke(37, 99, 235); strokeWeight(4);",
    "  beginShape();",
    "  for (let x = 96; x <= width - 48; x += 6) {",
    "    vertex(x, graphValue(x, mode));",
    "  }",
    "  endShape();",
    "  if (mode === 'limits') {",
    "    stroke(37, 99, 235); strokeWeight(3);",
    "    noFill();",
    "    circle(246, graphValue(246, mode), 10);",
    "    stroke(239, 68, 68); strokeWeight(2);",
    "    line(220, graphValue(220, mode) + 6, 226, graphValue(226, mode) - 10);",
    "    line(266, graphValue(266, mode) - 12, 272, graphValue(272, mode) + 6);",
    "  } else if (mode === 'continuity') {",
    "    stroke(37, 99, 235); strokeWeight(3);",
    "    noFill();",
    "    circle(244, graphValue(244, mode), 10);",
    "    fill(37, 99, 235); noStroke(); circle(320, graphValue(320, mode), 9);",
    "  }",
    "}",
    "function drawCursor() {",
    "  const x = constrain(mouseX, 96, width - 48);",
    "  const y = graphValue(x, " + mode + ");",
    "  stroke(239, 68, 68); strokeWeight(2);",
    "  line(x, height / 2, x, y);",
    "  line(x, y, 96, y);",
    "  fill(239, 68, 68); noStroke(); circle(x, y, 11);",
    "  fill(15); textSize(12);",
    "  text(`value ${nf(y, 1, 0)}`, x + 12, y - 12);",
    "}",
    "function graphValue(x, mode) {",
    "  if (mode === 'limits') {",
    "    if (x < 244) { return 188 - 0.48 * (x - 138) - 16 * sin((x - 120) * 0.028); }",
    "    return 178 + 0.44 * (x - 244) + 12 * sin((x - 240) * 0.024);",
    "  }",
    "  if (mode === 'continuity') {",
    "    if (x < 252) { return 192 - 0.38 * (x - 120) - 8 * sin((x - 110) * 0.027); }",
    "    return 168 + 0.28 * (x - 252) + 5 * sin((x - 252) * 0.03);",
    "  }",
    "  return 188 - 26 * sin((x - 240) * 0.02) - 0.0032 * pow(x - 240, 2);",
    "}",
  ]);
}

function buildSlopeExplorerSketch(
  title: string,
  subtitle: string,
  variant: "average_rate" | "derivative" | "power_rule",
): string {
  const mode = quote(variant);
  return sketch([
    "function setup() {",
    "  createCanvas(480, 320);",
    "  textFont('Arial');",
    "}",
    "function draw() {",
    "  background(248);",
    "  drawGrid();",
    "  drawAxes();",
    "  drawCurve();",
    "  drawSlopeTools();",
    ...buildBannerLines(title, subtitle),
    "  fill(15); textSize(12); text('The red line updates with the cursor and shows the local slope idea.', 24, 290);",
    "}",
    "function drawGrid() {",
    "  stroke(228); strokeWeight(1);",
    "  for (let x = 48; x <= width - 48; x += 24) { line(x, 64, x, height - 48); }",
    "  for (let y = 64; y <= height - 48; y += 24) { line(48, y, width - 48, y); }",
    "}",
    "function drawAxes() {",
    "  stroke(45); strokeWeight(2);",
    "  line(64, height / 2, width - 36, height / 2);",
    "  line(96, 52, 96, height - 40);",
    "  noStroke(); fill(92); textSize(11);",
    "  text('x', width - 38, height / 2 - 8);",
    "  text('y', 102, 62);",
    "}",
    "function curveValue(x) {",
    `  const mode = ${mode};`,
    "  if (mode === 'power_rule') {",
    "    return 190 - 0.0025 * pow(x - 240, 2) + 14 * sin((x - 240) * 0.025);",
    "  }",
    "  if (mode === 'average_rate') {",
    "    return 186 - 0.0018 * pow(x - 240, 2) + 18 * sin((x - 240) * 0.02);",
    "  }",
    "  return 184 - 0.0022 * pow(x - 240, 2) + 16 * sin((x - 240) * 0.022);",
    "}",
    "function drawCurve() {",
    "  noFill(); stroke(37, 99, 235); strokeWeight(4);",
    "  beginShape();",
    "  for (let x = 96; x <= width - 48; x += 6) {",
    "    vertex(x, curveValue(x));",
    "  }",
    "  endShape();",
    "}",
    "function drawSlopeTools() {",
    `  const mode = ${mode};`,
    "  const x0 = constrain(mouseX, 118, width - 118);",
    "  const x1 = mode === 'average_rate' ? min(width - 118, x0 + 72) : x0 + 18;",
    "  const y0 = curveValue(x0);",
    "  const y1 = curveValue(x1);",
    "  const slope = (y1 - y0) / max(1, x1 - x0);",
    "  stroke(239, 68, 68); strokeWeight(3);",
    "  line(x0, y0, x1, y1);",
    "  stroke(15); strokeWeight(2); fill(239, 68, 68); circle(x0, y0, 11); circle(x1, y1, 11);",
    "  fill(15); textSize(12);",
    "  text(mode === 'average_rate' ? 'secant slope' : 'tangent slope', x0 + 12, y0 - 12);",
    "  text(`slope ${nf(slope, 1, 2)}`, 24, 276);",
    "  if (mode === 'derivative') {",
    "    stroke(15); strokeWeight(1);",
    "    line(x0, y0, x0 + 40, curveValue(x0 + 40));",
    "    text('instantaneous rate', 24, 292);",
    "  }",
    "  if (mode === 'power_rule') {",
    "    text('power rule turns the curve into a slope pattern', 24, 292);",
    "  }",
    "}",
  ]);
}

function buildTrigSceneSketch(
  title: string,
  subtitle: string,
  variant: "unit_circle" | "triangle_ratio" | "wave" | "identity" | "equation",
): string {
  const mode = quote(variant);
  return sketch([
    "function setup() {",
    "  createCanvas(480, 320);",
    "  textFont('Arial');",
    "}",
    "function draw() {",
    "  background(248);",
    "  drawGrid();",
    "  drawScene();",
    ...buildBannerLines(title, subtitle),
    "  fill(15); textSize(12);",
    "  text('The visual stays deterministic and uses the animation only to reinforce the idea.', 24, 290);",
    "}",
    "function drawGrid() {",
    "  stroke(228); strokeWeight(1);",
    "  for (let x = 48; x <= width - 48; x += 24) { line(x, 64, x, height - 48); }",
    "  for (let y = 64; y <= height - 48; y += 24) { line(48, y, width - 48, y); }",
    "}",
    "function drawScene() {",
    `  const mode = ${mode};`,
    "  if (mode === 'triangle_ratio') {",
    "    drawTriangleRatioScene();",
    "    return;",
    "  }",
    "  if (mode === 'wave') {",
    "    drawWaveScene();",
    "    return;",
    "  }",
    "  if (mode === 'identity') {",
    "    drawIdentityScene();",
    "    return;",
    "  }",
    "  if (mode === 'equation') {",
    "    drawEquationScene();",
    "    return;",
    "  }",
    "  drawUnitCircleScene();",
    "}",
    "function drawUnitCircleScene() {",
    "  const cx = 168;",
    "  const cy = 160;",
    "  const radius = 88;",
    "  const angle = frameCount * 0.018;",
    "  const px = cx + radius * cos(angle);",
    "  const py = cy - radius * sin(angle);",
    "  stroke(15); strokeWeight(2); noFill();",
    "  line(48, cy, width - 48, cy);",
    "  line(cx, 52, cx, height - 40);",
    "  circle(cx, cy, radius * 2);",
    "  stroke(37, 99, 235); strokeWeight(3);",
    "  line(cx, cy, px, py);",
    "  stroke(239, 68, 68); line(px, py, px, cy);",
    "  stroke(16, 185, 129); line(px, py, cx, py);",
    "  noStroke();",
    "  fill(37, 99, 235); circle(px, py, 12);",
    "  fill(15); textSize(12);",
    "  text('cos', cx + radius + 14, cy + 4);",
    "  text('sin', cx + 8, cy - radius - 8);",
    "  text(`angle ${nf(angle, 1, 2)} rad`, 252, 86);",
    "  text('unit circle', 252, 108);",
    "}",
    "function drawTriangleRatioScene() {",
    "  const baseX = 92;",
    "  const baseY = 228;",
    "  const widthValue = 156 + 16 * sin(frameCount * 0.02);",
    "  const heightValue = 102 + 8 * cos(frameCount * 0.02);",
    "  stroke(15); strokeWeight(2); noFill();",
    "  line(baseX, baseY, baseX + widthValue, baseY);",
    "  line(baseX, baseY, baseX, baseY - heightValue);",
    "  line(baseX, baseY - heightValue, baseX + widthValue, baseY);",
    "  fill(37, 99, 235); noStroke(); circle(baseX, baseY, 10);",
    "  circle(baseX + widthValue, baseY, 10);",
    "  circle(baseX, baseY - heightValue, 10);",
    "  fill(15); textSize(12);",
    "  text('adjacent', baseX + 54, baseY + 18);",
    "  text('opposite', baseX - 72, baseY - heightValue / 2);",
    "  text('hypotenuse', baseX + 58, baseY - heightValue / 2 - 10);",
    "  text('right triangle ratios', 270, 118);",
    "  text('sine = opposite / hypotenuse', 270, 142);",
    "  text('cosine = adjacent / hypotenuse', 270, 164);",
    "  stroke(239, 68, 68); strokeWeight(2);",
    "  arc(baseX, baseY, 68, 68, -PI / 2, -PI / 4);",
    "}",
    "function drawWaveScene() {",
    "  const cx = 138;",
    "  const cy = 160;",
    "  const radius = 64;",
    "  const angle = frameCount * 0.02;",
    "  const waveLeft = 228;",
    "  stroke(15); strokeWeight(2); noFill();",
    "  circle(cx, cy, radius * 2);",
    "  line(cx, cy, cx + radius * cos(angle), cy - radius * sin(angle));",
    "  fill(37, 99, 235); noStroke();",
    "  circle(cx + radius * cos(angle), cy - radius * sin(angle), 10);",
    "  stroke(15); line(cx + radius * cos(angle), cy - radius * sin(angle), cx + radius * cos(angle), cy);",
    "  line(cx + radius * cos(angle), cy - radius * sin(angle), cx, cy - radius * sin(angle));",
    "  stroke(37, 99, 235); strokeWeight(3); noFill();",
    "  beginShape();",
    "  for (let x = waveLeft; x <= width - 48; x += 5) {",
    "    const t = (x - waveLeft) * 0.07 - angle * 2;",
    "    vertex(x, 176 - 36 * sin(t));",
    "  }",
    "  endShape();",
    "  fill(15); textSize(12);",
    "  text('wave output', 268, 88);",
    "  text('sine / cosine / tangent', 268, 110);",
    "  stroke(239, 68, 68); strokeWeight(2);",
    "  const waveX = waveLeft + 92;",
    "  const waveY = 176 - 36 * sin((waveX - waveLeft) * 0.07 - angle * 2);",
    "  line(waveX, 70, waveX, 232);",
    "  circle(waveX, waveY, 10);",
    "}",
    "function drawIdentityScene() {",
    "  const cx = 128;",
    "  const cy = 178;",
    "  const radius = 86;",
    "  stroke(15); strokeWeight(2); noFill();",
    "  line(48, cy, 220, cy);",
    "  line(cx, 66, cx, 260);",
    "  circle(cx, cy, radius * 2);",
    "  const angle = frameCount * 0.016;",
    "  const px = cx + radius * cos(angle);",
    "  const py = cy - radius * sin(angle);",
    "  stroke(37, 99, 235); strokeWeight(3); line(cx, cy, px, py);",
    "  stroke(239, 68, 68); line(px, py, px, cy);",
    "  stroke(16, 185, 129); line(px, py, cx, py);",
    "  fill(37, 99, 235); noStroke(); circle(px, py, 10);",
    "  fill(15); textSize(12);",
    "  text('sin^2(theta) + cos^2(theta) = 1', 250, 116);",
    "  text('identity board', 250, 138);",
    "  text('reciprocal functions share the same base angle', 250, 160);",
    "}",
    "function drawEquationScene() {",
    "  const graphLeft = 120;",
    "  const graphTop = 96;",
    "  const graphBottom = 232;",
    "  stroke(15); strokeWeight(2);",
    "  line(graphLeft, graphBottom, width - 48, graphBottom);",
    "  line(graphLeft, graphTop, graphLeft, graphBottom);",
    "  noFill(); stroke(37, 99, 235); strokeWeight(3);",
    "  beginShape();",
    "  for (let x = graphLeft; x <= width - 56; x += 5) {",
    "    vertex(x, 164 - 34 * sin((x - graphLeft) * 0.08));",
    "  }",
    "  endShape();",
    "  stroke(16, 185, 129);",
    "  beginShape();",
    "  for (let x = graphLeft; x <= width - 56; x += 5) {",
    "    vertex(x, 164 - 24 * cos((x - graphLeft) * 0.08));",
    "  }",
    "  endShape();",
    "  const markerX = graphLeft + 132;",
    "  const markerY = 164 - 34 * sin((markerX - graphLeft) * 0.08);",
    "  fill(239, 68, 68); noStroke(); circle(markerX, markerY, 10);",
    "  fill(15); textSize(12);",
    "  text('trig equations', 252, 110);",
    "  text('solution point', 252, 132);",
    "  text('graph intersection', 252, 154);",
    "}",
  ]);
}

function buildTransformFlowSketch(
  title: string,
  subtitle: string,
  variant: "chain_rule" | "product_rule" | "quotient_rule",
): string {
  const mode = quote(variant);
  return sketch([
    "function setup() {",
    "  createCanvas(480, 320);",
    "  textFont('Arial');",
    "}",
    "function draw() {",
    "  background(248);",
    "  drawGrid();",
    "  drawFlow();",
    ...buildBannerLines(title, subtitle),
    "  fill(15); textSize(12); text('The moving token shows how expressions combine or nest.', 24, 290);",
    "}",
    "function drawGrid() {",
    "  stroke(230); strokeWeight(1);",
    "  for (let x = 48; x <= width - 48; x += 24) { line(x, 64, x, height - 48); }",
    "  for (let y = 64; y <= height - 48; y += 24) { line(48, y, width - 48, y); }",
    "}",
    "function box(x, y, w, h, fillColor, label, sublabel) {",
    "  fill(fillColor); stroke(15); strokeWeight(2); rectMode(CENTER); rect(x, y, w, h, 16);",
    "  fill(255); noStroke(); textAlign(CENTER, CENTER); textSize(14); text(label, x, y - 8);",
    "  textSize(11); text(sublabel, x, y + 10);",
    "  rectMode(CORNER); textAlign(LEFT, BASELINE);",
    "}",
    "function drawArrow(x1, y1, x2, y2) {",
    "  stroke(15); strokeWeight(3); line(x1, y1, x2, y2);",
    "  const angle = atan2(y2 - y1, x2 - x1);",
    "  push(); translate(x2, y2); rotate(angle);",
    "  line(0, 0, -10, -5); line(0, 0, -10, 5);",
    "  pop();",
    "}",
    "function drawFlow() {",
    `  const mode = ${mode};`,
    "  if (mode === 'chain_rule') {",
    "    box(112, 162, 96, 74, color(37, 99, 235), 'x', 'input');",
    "    box(240, 162, 96, 74, color(16, 185, 129), 'g(x)', 'inner');",
    "    box(368, 162, 120, 84, color(239, 68, 68), 'f(g(x))', 'output');",
    "    drawArrow(160, 162, 192, 162);",
    "    drawArrow(288, 162, 308, 162);",
    "    const orbX = 112 + 128 * abs(sin(frameCount * 0.02));",
    "    const orbY = 162;",
    "    fill(255); stroke(15); strokeWeight(2); circle(orbX, orbY, 16);",
    "    textSize(12); noStroke(); fill(15); text('chain', 32, 274);",
    "  } else if (mode === 'product_rule') {",
    "    box(116, 138, 94, 68, color(37, 99, 235), 'u(x)', 'track A');",
    "    box(116, 222, 94, 68, color(16, 185, 129), 'v(x)', 'track B');",
    "    box(280, 180, 104, 82, color(239, 68, 68), 'u*v', 'merged');",
    "    box(412, 180, 88, 82, color(234, 88, 12), 'd/dx', 'rate');",
    "    drawArrow(163, 138, 231, 160);",
    "    drawArrow(163, 222, 231, 200);",
    "    drawArrow(332, 180, 366, 180);",
    "    const pulse = 8 * sin(frameCount * 0.05);",
    "    stroke(15); strokeWeight(2); noFill(); ellipse(280, 180, 120 + pulse, 48);",
    "  } else {",
    "    box(112, 162, 94, 72, color(37, 99, 235), 'u(x)', 'numerator');",
    "    box(246, 120, 94, 72, color(16, 185, 129), 'v(x)', 'denominator');",
    "    box(380, 162, 104, 82, color(239, 68, 68), 'u/v', 'quotient');",
    "    drawArrow(160, 162, 198, 162);",
    "    drawArrow(160, 120, 198, 142);",
    "    drawArrow(294, 142, 332, 162);",
    "    const orbX = 112 + 136 * abs(sin(frameCount * 0.018));",
    "    const orbY = 120 + 42 * cos(frameCount * 0.018);",
    "    fill(255); stroke(15); strokeWeight(2); circle(orbX, orbY, 16);",
    "  }",
    "}",
  ]);
}

export function selectVisualFamily(input: VisualTemplateInput): VisualFamilyKey | null {
  for (const family of VISUAL_FAMILY_REGISTRY) {
    if (family.matches(input)) {
      return family.key;
    }
  }

  return null;
}

export function selectVisualTemplate(input: VisualTemplateInput): VisualTemplate | null {
  return selectTemplate(input);
}

function isVisualFamilyPolicyVerified(
  family: VisualFamilyKey,
  input: VisualTemplateInput,
): boolean {
  const policy = VISUAL_VERIFICATION_POLICIES[family];
  if (!policy) {
    return false;
  }

  return (
    policy.allowedSubjects.includes(input.subject) &&
    policy.allowedTopics.includes(input.topic)
  );
}

export function buildDeterministicVisualArtifact(input: VisualTemplateInput): VisualNodeArtifact {
  const family = selectVisualFamily(input);
  if (family === null || !isVisualFamilyPolicyVerified(family, input)) {
    return {
      id: input.node.id,
      p5_code: "",
      visual_verified: false,
    };
  }

  const template = selectVisualTemplate(input);

  if (template === null) {
    return {
      id: input.node.id,
      p5_code: "",
      visual_verified: false,
    };
  }

  const title = input.node.title;
  const subtitle = `${input.subject} / ${input.topic}`;
  let p5Code = "";

  switch (template.kind) {
    case "function_graph":
      p5Code = buildFunctionGraphSketch(title, subtitle, template.variant);
      break;
    case "slope_explorer":
      p5Code = buildSlopeExplorerSketch(title, subtitle, template.variant);
      break;
    case "trig_scene":
      p5Code = buildTrigSceneSketch(title, subtitle, template.variant);
      break;
    case "transform_flow":
      p5Code = buildTransformFlowSketch(title, subtitle, template.variant);
      break;
  }

  return {
    id: input.node.id,
    p5_code: p5Code,
    visual_verified: true,
  };
}
