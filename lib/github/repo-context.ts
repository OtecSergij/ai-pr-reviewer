/**
 * Координаты репозитория на конкретном коммите — всё, что нужно, чтобы собрать
 * ссылку на GitHub blob (github.com/owner/repo/blob/<headSha>/…). Родственник
 * PRRef, но про снапшот кода (headSha), а не про номер PR.
 */
export type RepoContext = { owner: string; repo: string; headSha: string };
