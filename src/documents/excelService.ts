import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { HearingAnswer } from '../db/repositories/hearingAnswerRepository';

interface TeamMember { name: string; role: string }
interface IssueEntry  { id: number; title: string; category: string; status: string; note: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function headerRow(sheet: ExcelJS.Worksheet, cols: string[], color = '2F5496'): void {
  const row = sheet.addRow(cols);
  row.eachCell((cell: ExcelJS.Cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } };
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  sheet.getRow(1).height = 20;
}

function setColWidths(sheet: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
}

function labelValue(sheet: ExcelJS.Worksheet, label: string, value: string | null): void {
  const row = sheet.addRow([label, value ?? '（未回答）']);
  row.getCell(1).font = { bold: true };
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
}

// ─── 要件定義書 ─────────────────────────────────────────────────────────────

export async function generateRequirementsExcel(
  workspacePath: string,
  projectName: string,
  answers: HearingAnswer,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Creaters Tool Engineer';
  wb.created = new Date();

  // Sheet 1: プロジェクト概要
  const overview = wb.addWorksheet('プロジェクト概要');
  setColWidths(overview, [24, 80]);
  overview.addRow(['要件定義書', `プロジェクト: ${projectName}`]);
  overview.getRow(1).font = { bold: true, size: 14 };
  overview.addRow([]);
  labelValue(overview, '作成日時', new Date().toISOString().slice(0, 10));
  labelValue(overview, 'プロジェクト名', projectName);
  labelValue(overview, '目的・背景', answers.purpose);
  labelValue(overview, 'ターゲットユーザー', answers.targetUsers);
  labelValue(overview, '必須機能', answers.requiredFeatures);
  labelValue(overview, '画面一覧', answers.screens);
  labelValue(overview, '技術スタック', answers.techStack);
  labelValue(overview, '優先度', answers.priority);
  labelValue(overview, 'デプロイ環境', answers.deployment);
  labelValue(overview, 'テスト範囲', answers.testScope);

  // Sheet 2: 機能一覧
  const featureSheet = wb.addWorksheet('機能一覧');
  setColWidths(featureSheet, [6, 30, 50, 16, 16]);
  headerRow(featureSheet, ['No.', '機能名', '説明', '優先度', 'ステータス']);
  const features = (answers.requiredFeatures ?? '').split(/[,、\n]/).map((f) => f.trim()).filter(Boolean);
  features.forEach((f, i) => featureSheet.addRow([i + 1, f, '', '高', '未着手']));

  const outPath = path.join(workspacePath, 'docs', '要件定義書.xlsx');
  ensureDir(outPath);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

// ─── 基本設計書 ─────────────────────────────────────────────────────────────

export async function generateBasicDesignExcel(
  workspacePath: string,
  projectName: string,
  answers: HearingAnswer,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Creaters Tool Engineer';

  const overview = wb.addWorksheet('システム概要');
  setColWidths(overview, [24, 80]);
  overview.addRow(['基本設計書', `プロジェクト: ${projectName}`]);
  overview.getRow(1).font = { bold: true, size: 14 };
  overview.addRow([]);
  labelValue(overview, '作成日時', new Date().toISOString().slice(0, 10));
  labelValue(overview, 'システム目的', answers.purpose);
  labelValue(overview, '技術スタック', answers.techStack);
  labelValue(overview, 'デプロイ環境', answers.deployment);

  const archSheet = wb.addWorksheet('アーキテクチャ');
  setColWidths(archSheet, [24, 60, 40]);
  headerRow(archSheet, ['レイヤー', '説明', '採用技術']);
  archSheet.addRow(['フロントエンド', '', '']);
  archSheet.addRow(['バックエンド',   '', '']);
  archSheet.addRow(['データベース',   '', '']);
  archSheet.addRow(['インフラ',       '', '']);

  const screenSheet = wb.addWorksheet('画面一覧');
  setColWidths(screenSheet, [6, 30, 50, 16]);
  headerRow(screenSheet, ['No.', '画面名', '説明', 'ステータス']);
  const screens = (answers.screens ?? '').split(/[,、\n]/).map((s) => s.trim()).filter(Boolean);
  screens.forEach((s, i) => screenSheet.addRow([i + 1, s, '', '未着手']));

  const apiSheet = wb.addWorksheet('API一覧');
  setColWidths(apiSheet, [6, 14, 40, 40, 16]);
  headerRow(apiSheet, ['No.', 'メソッド', 'エンドポイント', '説明', 'ステータス']);

  const outPath = path.join(workspacePath, 'docs', '基本設計書.xlsx');
  ensureDir(outPath);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

// ─── 詳細設計書 ─────────────────────────────────────────────────────────────

export async function generateDetailedDesignExcel(
  workspacePath: string,
  projectName: string,
  answers: HearingAnswer,
  includeErDiagram = false,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Creaters Tool Engineer';

  const overview = wb.addWorksheet('概要');
  setColWidths(overview, [24, 80]);
  overview.addRow(['詳細設計書', `プロジェクト: ${projectName}`]);
  overview.getRow(1).font = { bold: true, size: 14 };
  overview.addRow([]);
  labelValue(overview, '作成日時', new Date().toISOString().slice(0, 10));
  labelValue(overview, '技術スタック', answers.techStack);

  const compSheet = wb.addWorksheet('コンポーネント設計');
  setColWidths(compSheet, [6, 30, 50, 30, 16]);
  headerRow(compSheet, ['No.', 'コンポーネント名', '責務', '依存関係', 'ステータス']);

  const dbSheet = wb.addWorksheet('DB設計');
  setColWidths(dbSheet, [20, 16, 12, 8, 40]);
  headerRow(dbSheet, ['テーブル名 / カラム名', 'データ型', 'NULL', 'PK', '説明']);

  if (includeErDiagram) {
    const erSheet = wb.addWorksheet('ER図（テキスト）');
    setColWidths(erSheet, [30, 30, 20]);
    headerRow(erSheet, ['テーブル', '関連テーブル', 'リレーション']);
    erSheet.addRow(['（ER図をここに記載）', '', '']);
  }

  const apiSheet = wb.addWorksheet('API詳細');
  setColWidths(apiSheet, [6, 14, 40, 60, 60]);
  headerRow(apiSheet, ['No.', 'メソッド', 'エンドポイント', 'リクエスト例', 'レスポンス例']);

  const outPath = path.join(workspacePath, 'docs', '詳細設計書.xlsx');
  ensureDir(outPath);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

// ─── 画面設計書 ─────────────────────────────────────────────────────────────

export async function generateScreenDesignExcel(
  workspacePath: string,
  projectName: string,
  answers: HearingAnswer,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Creaters Tool Engineer';

  const screenList = wb.addWorksheet('画面一覧');
  setColWidths(screenList, [6, 30, 50, 30, 16]);
  screenList.addRow(['画面設計書', `プロジェクト: ${projectName}`]);
  screenList.getRow(1).font = { bold: true, size: 14 };
  screenList.addRow([]);
  headerRow(screenList, ['No.', '画面名', 'URL / 遷移元', '遷移先', 'ステータス'], '375623');
  const screens = (answers.screens ?? '').split(/[,、\n]/).map((s) => s.trim()).filter(Boolean);
  screens.forEach((s, i) => screenList.addRow([i + 1, s, '', '', '未着手']));

  const flowSheet = wb.addWorksheet('画面遷移図（テキスト）');
  setColWidths(flowSheet, [30, 20, 30, 40]);
  headerRow(flowSheet, ['画面名', '操作 / イベント', '遷移先画面', '備考'], '375623');

  const itemSheet = wb.addWorksheet('画面項目定義');
  setColWidths(itemSheet, [20, 30, 16, 16, 16, 40]);
  headerRow(itemSheet, ['画面名', '項目名', '入力種別', '必須', 'バリデーション', '説明'], '375623');

  const outPath = path.join(workspacePath, 'docs', '画面設計書.xlsx');
  ensureDir(outPath);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

// ─── テスト仕様書 ────────────────────────────────────────────────────────────

export async function generateTestSpecExcel(
  workspacePath: string,
  projectName: string,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Creaters Tool Engineer';

  const overview = wb.addWorksheet('概要');
  setColWidths(overview, [24, 80]);
  overview.addRow(['テスト仕様書（自動テスト）', `プロジェクト: ${projectName}`]);
  overview.getRow(1).font = { bold: true, size: 14 };
  overview.addRow([]);
  labelValue(overview, '作成日時', new Date().toISOString().slice(0, 10));

  const caseSheet = wb.addWorksheet('テストケース');
  setColWidths(caseSheet, [8, 20, 40, 40, 16, 16, 20]);
  headerRow(caseSheet, ['No.', 'テスト対象', '前提条件', '手順・入力値', '期待結果', '判定', '備考'], '833C00');

  const resultSheet = wb.addWorksheet('テスト結果');
  setColWidths(resultSheet, [8, 20, 16, 20, 40]);
  headerRow(resultSheet, ['No.', 'テスト対象', '判定', '実施日時', '備考'], '833C00');

  const outPath = path.join(workspacePath, 'docs', 'テスト仕様書.xlsx');
  ensureDir(outPath);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

// ─── 手動テスト仕様書 ────────────────────────────────────────────────────────

export async function generateManualTestSpecExcel(
  workspacePath: string,
  projectName: string,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Creaters Tool Engineer';

  const overview = wb.addWorksheet('概要');
  setColWidths(overview, [24, 80]);
  overview.addRow(['手動テスト仕様書', `プロジェクト: ${projectName}`]);
  overview.getRow(1).font = { bold: true, size: 14 };
  overview.addRow([]);
  labelValue(overview, '作成日時', new Date().toISOString().slice(0, 10));
  overview.addRow(['説明', '本書は自動テストでカバーできない手動確認項目をまとめたものです。']);

  const caseSheet = wb.addWorksheet('手動テストケース');
  setColWidths(caseSheet, [8, 24, 50, 50, 16, 16, 20]);
  headerRow(caseSheet, ['No.', 'カテゴリ', '確認内容', '手順', '期待結果', '確認者', '備考'], 'C55A11');

  const checkSheet = wb.addWorksheet('リリース前チェックリスト');
  setColWidths(checkSheet, [8, 50, 16, 16]);
  headerRow(checkSheet, ['No.', '確認項目', '担当', '完了'], 'C55A11');
  [
    'UI表示が崩れていないか',
    '入力バリデーションが動作するか',
    'エラーメッセージが適切か',
    'レスポンシブ表示が正常か',
    '本番環境での動作確認',
  ].forEach((item, i) => caseSheet.addRow([i + 1, 'リリース前確認', item, '', 'OK', '', '']));

  const outPath = path.join(workspacePath, 'docs', '手動テスト仕様書.xlsx');
  ensureDir(outPath);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

// ─── 課題リスト ──────────────────────────────────────────────────────────────

export async function generateIssueListExcel(
  workspacePath: string,
  projectName: string,
  issues: IssueEntry[] = [],
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Creaters Tool Engineer';

  const sheet = wb.addWorksheet('課題リスト');
  sheet.addRow(['課題リスト', `プロジェクト: ${projectName}`]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([]);
  setColWidths(sheet, [6, 40, 20, 16, 60]);
  headerRow(sheet, ['No.', 'タイトル', 'カテゴリ', 'ステータス', '備考'], '7030A0');
  issues.forEach((iss) => sheet.addRow([iss.id, iss.title, iss.category, iss.status, iss.note]));

  const manualSheet = wb.addWorksheet('手作業一覧');
  setColWidths(manualSheet, [6, 50, 20, 16, 30, 60]);
  headerRow(manualSheet, ['No.', '作業内容', 'カテゴリ', '担当', '期限', '備考'], '7030A0');
  manualSheet.addRow(['（pending-actions.md から転記）', '', '', '', '', '']);

  const outPath = path.join(workspacePath, 'docs', '課題リスト.xlsx');
  ensureDir(outPath);
  await wb.xlsx.writeFile(outPath);
  return outPath;
}

// ─── 全書類まとめて生成 ──────────────────────────────────────────────────────

export interface ExcelDocPaths {
  requirements:   string;
  basicDesign:    string;
  detailedDesign: string;
  screenDesign?:  string;
  testSpec:       string;
  manualTestSpec: string;
  issueList:      string;
}

export async function generateAllExcelDocs(
  workspacePath: string,
  projectName: string,
  answers: HearingAnswer,
  options: { includeScreenDesign?: boolean; includeErDiagram?: boolean } = {},
): Promise<ExcelDocPaths> {
  const [requirements, basicDesign, detailedDesign, testSpec, manualTestSpec, issueList] =
    await Promise.all([
      generateRequirementsExcel(workspacePath, projectName, answers),
      generateBasicDesignExcel(workspacePath, projectName, answers),
      generateDetailedDesignExcel(workspacePath, projectName, answers, options.includeErDiagram),
      generateTestSpecExcel(workspacePath, projectName),
      generateManualTestSpecExcel(workspacePath, projectName),
      generateIssueListExcel(workspacePath, projectName),
    ]);

  const result: ExcelDocPaths = { requirements, basicDesign, detailedDesign, testSpec, manualTestSpec, issueList };

  if (options.includeScreenDesign || (answers.screens && answers.screens.trim().length > 0)) {
    result.screenDesign = await generateScreenDesignExcel(workspacePath, projectName, answers);
  }

  return result;
}
