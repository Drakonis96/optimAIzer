import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

// ---------------------------------------------------------------------------
// Setup: temporary data directory
// ---------------------------------------------------------------------------

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimaizer-doctool-'));

before(() => {
  process.env.DATA_DIR = tempDir;
  // Create the documents output directory
  const docsDir = path.join(tempDir, 'agents', 'test-user', 'test-agent', 'documents');
  fs.mkdirSync(docsDir, { recursive: true });
});

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Word Document Tests
// ---------------------------------------------------------------------------

describe('Document Tools — Word (.docx)', () => {
  const userId = 'test-user';
  const agentId = 'test-agent';
  let createdFilePath = '';

  test('create_word generates a .docx file with headings, paragraphs, bullets, and tables', async () => {
    const { createWord } = await import('../server/src/agents/documentTools');

    const result = await createWord({
      userId,
      agentId,
      fileName: 'test-report.docx',
      content: [
        { type: 'heading', text: 'Monthly Report', level: 1 },
        { type: 'paragraph', text: 'This is the executive summary.', bold: true },
        { type: 'paragraph', text: 'Additional details about the report.', italic: true },
        { type: 'heading', text: 'Key Metrics', level: 2 },
        { type: 'bullet', text: 'Revenue: $150K', level: 1 },
        { type: 'bullet', text: 'Costs: $80K', level: 1 },
        { type: 'bullet', text: 'Sub-item', level: 2 },
        { type: 'table', rows: [['Metric', 'Value'], ['Sales', '150'], ['Returns', '12']] },
      ],
    });

    assert.ok(result.filePath.endsWith('.docx'), 'File should have .docx extension');
    assert.ok(result.size > 0, 'File size should be positive');
    assert.ok(fs.existsSync(result.filePath), 'File should exist on disk');
    createdFilePath = result.filePath;
  });

  test('read_word extracts text from a .docx file', async () => {
    const { readWord } = await import('../server/src/agents/documentTools');

    assert.ok(createdFilePath, 'Should have a created file to read');
    const result = await readWord(createdFilePath);

    assert.ok(result.text.includes('Monthly Report'), 'Should contain heading text');
    assert.ok(result.text.includes('executive summary'), 'Should contain paragraph text');
    assert.ok(result.text.includes('Revenue'), 'Should contain bullet text');
    assert.ok(result.text.includes('Sales'), 'Should contain table text');
    assert.ok(Array.isArray(result.styles), 'Styles should be an array');
  });
});

// ---------------------------------------------------------------------------
// PDF Document Tests
// ---------------------------------------------------------------------------

describe('Document Tools — PDF', () => {
  const userId = 'test-user';
  const agentId = 'test-agent';
  let createdFilePath = '';

  test('create_pdf generates a PDF with headings, text, and comments', async () => {
    const { createPdf } = await import('../server/src/agents/documentTools');

    const result = await createPdf({
      userId,
      agentId,
      fileName: 'test-document.pdf',
      content: [
        { type: 'heading', text: 'Test Document', fontSize: 24 },
        { type: 'text', text: 'This is a paragraph of text that should appear in the PDF document.' },
        { type: 'comment', text: 'This is a review comment' },
        { type: 'text', text: 'Another paragraph with important data.', bold: true },
        { type: 'page_break' },
        { type: 'heading', text: 'Page Two', fontSize: 18 },
        { type: 'text', text: 'Content on the second page.' },
      ],
    });

    assert.ok(result.filePath.endsWith('.pdf'), 'File should have .pdf extension');
    assert.ok(result.size > 0, 'File size should be positive');
    assert.ok(fs.existsSync(result.filePath), 'File should exist on disk');
    createdFilePath = result.filePath;
  });

  test('read_pdf extracts text from a PDF file', async () => {
    const { readPdf } = await import('../server/src/agents/documentTools');

    assert.ok(createdFilePath, 'Should have a created file to read');
    const result = await readPdf(createdFilePath);

    assert.ok(result.pageCount >= 2, 'Should have at least 2 pages');
    assert.ok(result.text.includes('Test Document'), 'Should contain heading text');
    assert.ok(result.text.includes('paragraph of text'), 'Should contain paragraph text');
    assert.ok(typeof result.metadata === 'object', 'Metadata should be an object');
  });

  test('annotate_pdf adds annotations to an existing PDF', async () => {
    const { annotatePdf } = await import('../server/src/agents/documentTools');

    assert.ok(createdFilePath, 'Should have a PDF to annotate');
    const result = await annotatePdf({
      userId,
      agentId,
      sourceFilePath: createdFilePath,
      outputFileName: 'annotated-document.pdf',
      annotations: [
        { page: 1, x: 50, y: 700, text: 'Approved', fontSize: 14, color: 'green' },
        { page: 1, x: 50, y: 300, text: 'Review needed', color: 'red' },
        { page: 2, x: 100, y: 500, text: 'Add references', color: 'blue' },
      ],
    });

    assert.ok(result.filePath.endsWith('.pdf'), 'Annotated file should have .pdf extension');
    assert.ok(result.size > 0, 'File size should be positive');
    assert.ok(fs.existsSync(result.filePath), 'Annotated file should exist on disk');
    assert.ok(result.size >= (fs.statSync(createdFilePath).size), 'Annotated PDF should be at least as large as original');
  });
});

// ---------------------------------------------------------------------------
// PowerPoint Tests
// ---------------------------------------------------------------------------

describe('Document Tools — PowerPoint (.pptx)', () => {
  const userId = 'test-user';
  const agentId = 'test-agent';

  test('create_powerpoint generates a .pptx with multiple slides, layouts, and notes', async () => {
    const { createPowerPoint } = await import('../server/src/agents/documentTools');

    const result = await createPowerPoint({
      userId,
      agentId,
      fileName: 'test-presentation.pptx',
      title: 'Test Presentation',
      author: 'Test Author',
      subject: 'Testing',
      slides: [
        {
          title: 'Welcome',
          subtitle: 'A Test Presentation',
          layout: 'title',
          notes: 'Welcome everyone. This is the opening slide.',
        },
        {
          title: 'Key Points',
          bulletPoints: ['Point one', 'Point two', 'Point three'],
          layout: 'content',
          notes: 'Cover each point in detail. Spend about 2 minutes on each.',
        },
        {
          title: 'Comparison',
          leftColumn: 'Before:\n- Slow process\n- Manual steps\n- High error rate',
          rightColumn: 'After:\n- Fast automation\n- Single click\n- Zero errors',
          layout: 'two_column',
          notes: 'Highlight the improvements. Focus on the error rate reduction.',
        },
        {
          title: 'Section Break',
          layout: 'section',
          notes: 'Pause here for questions.',
        },
        {
          title: 'Summary',
          content: 'Thank you for your attention.\n\nQuestions?',
          backgroundColor: '1F3864',
          fontColor: 'FFFFFF',
          notes: 'Conclude and open for Q&A.',
        },
      ],
    });

    assert.ok(result.filePath.endsWith('.pptx'), 'File should have .pptx extension');
    assert.ok(result.size > 0, 'File size should be positive');
    assert.ok(fs.existsSync(result.filePath), 'File should exist on disk');
    // PowerPoint files are typically >10KB
    assert.ok(result.size > 5000, `File should be substantial (got ${result.size} bytes)`);
  });

  test('create_powerpoint handles blank layout', async () => {
    const { createPowerPoint } = await import('../server/src/agents/documentTools');

    const result = await createPowerPoint({
      userId,
      agentId,
      fileName: 'test-blank.pptx',
      slides: [
        { layout: 'blank', notes: 'This is a blank slide for custom content.' },
      ],
    });

    assert.ok(result.filePath.endsWith('.pptx'));
    assert.ok(result.size > 0);
  });
});

// ---------------------------------------------------------------------------
// Excel Tests
// ---------------------------------------------------------------------------

describe('Document Tools — Excel (.xlsx)', () => {
  const userId = 'test-user';
  const agentId = 'test-agent';
  let createdFilePath = '';

  test('create_excel generates a .xlsx with headers, data, formulas, and styles', async () => {
    const { createExcel } = await import('../server/src/agents/documentTools');

    const result = await createExcel({
      userId,
      agentId,
      fileName: 'test-data.xlsx',
      author: 'Test Author',
      sheets: [
        {
          name: 'Sales',
          headers: ['Month', 'Product', 'Units', 'Price', 'Total'],
          rows: [
            ['January', 'Widget A', 100, 29.99, null],
            ['January', 'Widget B', 50, 49.99, null],
            ['February', 'Widget A', 120, 29.99, null],
          ],
          columnWidths: [12, 15, 10, 10, 12],
          headerStyle: { bold: true, backgroundColor: '4472C4', fontColor: 'FFFFFF' },
          formulas: [
            { cell: 'E2', formula: 'C2*D2' },
            { cell: 'E3', formula: 'C3*D3' },
            { cell: 'E4', formula: 'C4*D4' },
          ],
        },
        {
          name: 'Summary',
          headers: ['Metric', 'Value'],
          rows: [
            ['Total Units', null],
            ['Total Revenue', null],
          ],
          formulas: [
            { cell: 'B2', formula: "SUM('Sales'!C2:C4)" },
            { cell: 'B3', formula: "SUM('Sales'!E2:E4)" },
          ],
        },
      ],
    });

    assert.ok(result.filePath.endsWith('.xlsx'), 'File should have .xlsx extension');
    assert.ok(result.size > 0, 'File size should be positive');
    assert.ok(fs.existsSync(result.filePath), 'File should exist on disk');
    createdFilePath = result.filePath;
  });

  test('read_excel extracts data from a .xlsx file', async () => {
    const { readExcel } = await import('../server/src/agents/documentTools');

    assert.ok(createdFilePath, 'Should have a created file to read');
    const result = await readExcel(createdFilePath);

    assert.ok(result.sheets.length >= 2, 'Should have at least 2 sheets');

    const salesSheet = result.sheets.find((s) => s.name === 'Sales');
    assert.ok(salesSheet, 'Should have Sales sheet');
    assert.ok(salesSheet!.headers.includes('Month'), 'Headers should include Month');
    assert.ok(salesSheet!.headers.includes('Product'), 'Headers should include Product');
    assert.ok(salesSheet!.data.length >= 3, 'Should have at least 3 data rows (excluding header)');

    const summarySheet = result.sheets.find((s) => s.name === 'Summary');
    assert.ok(summarySheet, 'Should have Summary sheet');
  });

  test('edit_excel modifies cells, adds rows, and adds sheets', async () => {
    const { editExcel, readExcel } = await import('../server/src/agents/documentTools');

    assert.ok(createdFilePath, 'Should have a created file to edit');
    const result = await editExcel({
      userId,
      agentId,
      sourceFilePath: createdFilePath,
      outputFileName: 'test-data-edited.xlsx',
      operations: [
        { sheet: 'Sales', type: 'set_cell', cell: 'A5', value: 'March' },
        { sheet: 'Sales', type: 'add_row', row: ['March', 'Widget C', 200, 19.99] },
        { sheet: 'Sales', type: 'set_formula', cell: 'E5', formula: 'C5*D5' },
        { type: 'add_sheet', sheetName: 'Notes' },
        { sheet: 'Notes', type: 'set_cell', cell: 'A1', value: 'Updated on 2025-04-09' },
        { sheet: 'Summary', type: 'rename_sheet', newName: 'Overview' },
      ],
    });

    assert.ok(result.filePath.endsWith('.xlsx'), 'Edited file should have .xlsx extension');
    assert.ok(result.size > 0, 'File size should be positive');
    assert.ok(fs.existsSync(result.filePath), 'Edited file should exist on disk');

    // Verify edits
    const edited = await readExcel(result.filePath);
    const notesSheet = edited.sheets.find((s) => s.name === 'Notes');
    assert.ok(notesSheet, 'Should have added Notes sheet');

    const overviewSheet = edited.sheets.find((s) => s.name === 'Overview');
    assert.ok(overviewSheet, 'Summary sheet should be renamed to Overview');
  });
});

// ---------------------------------------------------------------------------
// Tool definitions integration test
// ---------------------------------------------------------------------------

describe('Document Tools — Tool Definitions', () => {
  test('AGENT_TOOLS includes all document tool definitions', async () => {
    const { AGENT_TOOLS } = await import('../server/src/agents/tools');

    const docToolNames = [
      'read_word', 'create_word',
      'read_pdf', 'create_pdf', 'annotate_pdf',
      'create_powerpoint',
      'read_excel', 'create_excel', 'edit_excel',
    ];

    for (const toolName of docToolNames) {
      const tool = AGENT_TOOLS.find((t) => t.name === toolName);
      assert.ok(tool, `AGENT_TOOLS should include "${toolName}"`);
      assert.ok(tool!.description, `"${toolName}" should have a description`);
      assert.ok(Object.keys(tool!.parameters).length > 0, `"${toolName}" should have parameters`);
    }
  });

  test('PARALLEL_SAFE_TOOLS includes read-only document tools', async () => {
    const { PARALLEL_SAFE_TOOLS } = await import('../server/src/agents/engine');

    assert.ok(PARALLEL_SAFE_TOOLS.has('read_word'), 'read_word should be parallel safe');
    assert.ok(PARALLEL_SAFE_TOOLS.has('read_pdf'), 'read_pdf should be parallel safe');
    assert.ok(PARALLEL_SAFE_TOOLS.has('read_excel'), 'read_excel should be parallel safe');

    // Write tools should NOT be parallel safe
    assert.ok(!PARALLEL_SAFE_TOOLS.has('create_word'), 'create_word should NOT be parallel safe');
    assert.ok(!PARALLEL_SAFE_TOOLS.has('create_pdf'), 'create_pdf should NOT be parallel safe');
    assert.ok(!PARALLEL_SAFE_TOOLS.has('create_powerpoint'), 'create_powerpoint should NOT be parallel safe');
    assert.ok(!PARALLEL_SAFE_TOOLS.has('create_excel'), 'create_excel should NOT be parallel safe');
  });
});

// ---------------------------------------------------------------------------
// Skill files existence test
// ---------------------------------------------------------------------------

describe('Document Skills — Builtin Skill Files', () => {
  const skillsDir = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../server/src/agents/skills/builtins',
  );

  const expectedSkills = [
    'word-documents.skill.md',
    'pdf-documents.skill.md',
    'powerpoint-presentations.skill.md',
    'excel-spreadsheets.skill.md',
  ];

  for (const skillFile of expectedSkills) {
    test(`builtin skill "${skillFile}" exists and has valid frontmatter`, () => {
      const filePath = path.join(skillsDir, skillFile);
      assert.ok(fs.existsSync(filePath), `Skill file should exist: ${skillFile}`);

      const content = fs.readFileSync(filePath, 'utf-8');
      assert.ok(content.startsWith('---'), 'Should start with YAML frontmatter');
      assert.ok(content.includes('id:'), 'Should have id field');
      assert.ok(content.includes('name:'), 'Should have name field');
      assert.ok(content.includes('name_en:'), 'Should have English name');
      assert.ok(content.includes('description:'), 'Should have description');
      assert.ok(content.includes('description_en:'), 'Should have English description');
      assert.ok(content.includes('category:'), 'Should have category');
      assert.ok(content.includes('requires_tools:'), 'Should have requires_tools');
      assert.ok(content.includes('<!-- lang:en -->'), 'Should have English section separator');
    });
  }
});
