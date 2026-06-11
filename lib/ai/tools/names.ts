/**
 * Имена тулов ревьюера — единая точка истины для сервера и клиента.
 * Сервер: фабрика makeReviewTools обязана вернуть ровно этот набор ключей
 * (`satisfies Record<ReviewToolName, …>`). Клиент: подписи активности в панели
 * матчатся по этим же константам. Переименование с одной стороны без другой
 * не скомпилируется.
 */
export const REVIEW_TOOL_NAMES = {
  getPrMetadata: "get_pr_metadata",
  getPrFilesSummary: "get_pr_files_summary",
  getDiff: "get_diff",
  getFileContents: "get_file_contents",
  listDirectory: "list_directory",
  emitIssue: "emit_issue",
} as const;

export type ReviewToolName =
  (typeof REVIEW_TOOL_NAMES)[keyof typeof REVIEW_TOOL_NAMES];
