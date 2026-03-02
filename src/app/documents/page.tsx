import { promises as fs } from "node:fs";
import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import GithubSlugger from "github-slugger";
import PageTitle from "@/components/PageTitle";
import { documentationDocs, getDocumentationDocByKey } from "@/lib/documentation";

type SearchParamsLike =
  | Record<string, string | string[] | undefined>
  | Promise<Record<string, string | string[] | undefined>>;

type TocItem = { id: string; level: number; text: string };

function stripFrontMatter(markdown: string): string {
  const normalized = markdown.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return markdown;
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) return markdown;
  return normalized.slice(end + 5).trimStart();
}

function buildToc(markdown: string): TocItem[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const slugger = new GithubSlugger();
  const out: TocItem[] = [];
  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (!m) continue;
    const level = m[1].length;
    const text = m[2].trim();
    const id = slugger.slug(text || "section");
    out.push({ level, text, id });
  }
  return out;
}

async function readDocContent(relativePath: string): Promise<string> {
  const abs = path.join(process.cwd(), relativePath);
  return fs.readFile(abs, "utf8");
}

export default async function DocumentsPage({ searchParams }: { searchParams?: SearchParamsLike }) {
  const resolvedSearchParams = (await Promise.resolve(searchParams || {})) as Record<string, string | string[] | undefined>;
  const docParamRaw = resolvedSearchParams.doc;
  const docKey = Array.isArray(docParamRaw) ? docParamRaw[0] : docParamRaw;
  const selectedDoc = getDocumentationDocByKey(docKey) || documentationDocs[0];

  let content = "";
  let loadError: string | null = null;
  try {
    content = await readDocContent(selectedDoc.path);
    content = stripFrontMatter(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : null;
    loadError = msg || "Impossible de lire le document.";
  }

  const toc = loadError ? [] : buildToc(content);

  return (
    <div className="space-y-6 -mx-2 lg:-mx-4 2xl:-mx-8">
      <div className="rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#fff,#f8fafc_45%,#eef2ff)] p-6 shadow-sm">
        <PageTitle kicker="Documentation" title="Centre de documentation (mode Hugo)" />
      </div>

      <section className="min-w-0 space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">Document sélectionné</span>
            <span className="text-slate-500">{selectedDoc.path}</span>
          </div>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">{selectedDoc.label}</h2>
          <p className="mt-1 text-sm text-slate-600">{selectedDoc.description}</p>
        </div>

        {loadError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            Erreur de lecture du document : {loadError}
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
            <aside className="hidden xl:block">
              <div className="sticky top-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Sommaire</div>
                {toc.length ? (
                  <div className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
                    {toc.map((item) => (
                      <a
                        key={`${item.id}-${item.level}`}
                        href={`#${item.id}`}
                        className={`block rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900 ${
                          item.level === 1 ? "font-semibold text-slate-800" : item.level === 2 ? "pl-2" : "pl-4"
                        }`}
                      >
                        {item.text}
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Aucun titre détecté.</p>
                )}
              </div>
            </aside>

            <article className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc,#eef2ff_35%,#f8fafc)] px-6 py-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Lecture</div>
                </div>

                <div className="px-6 py-6">
                  <div className="markdown-doc space-y-4 text-slate-700">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeSlug]}
                      components={{
                        h1: ({ node, ...props }) => <h1 className="scroll-mt-24 text-3xl font-semibold tracking-tight text-slate-900" {...props} />,
                        h2: ({ node, ...props }) => <h2 className="scroll-mt-24 mt-8 border-t border-slate-100 pt-4 text-2xl font-semibold text-slate-900" {...props} />,
                        h3: ({ node, ...props }) => <h3 className="scroll-mt-24 mt-6 text-lg font-semibold text-slate-800" {...props} />,
                        p: ({ node, ...props }) => <p className="leading-7" {...props} />,
                        ul: ({ node, ...props }) => <ul className="list-disc space-y-2 pl-6" {...props} />,
                        ol: ({ node, ...props }) => <ol className="list-decimal space-y-2 pl-6" {...props} />,
                        li: ({ node, ...props }) => <li className="leading-7" {...props} />,
                        hr: ({ node, ...props }) => <hr className="my-6 border-slate-200" {...props} />,
                        blockquote: ({ node, ...props }) => (
                          <blockquote className="rounded-r-xl border-l-4 border-amber-300 bg-amber-50/60 px-4 py-3" {...props} />
                        ),
                        a: ({ node, ...props }) => (
                          <a
                            className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
                            target={typeof props.href === "string" && props.href.startsWith("http") ? "_blank" : undefined}
                            rel={typeof props.href === "string" && props.href.startsWith("http") ? "noreferrer" : undefined}
                            {...props}
                          />
                        ),
                        code: ({ node, className, children, ...props }) => {
                          const isBlock = !!className;
                          if (isBlock) {
                            return (
                              <code className={`block overflow-x-auto rounded-xl bg-slate-950 p-4 text-sm leading-6 text-slate-100 ${className}`} {...props}>
                                {children}
                              </code>
                            );
                          }
                          return (
                            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.92em] text-slate-800" {...props}>
                              {children}
                            </code>
                          );
                        },
                        pre: ({ node, ...props }) => <pre className="my-4 overflow-x-auto" {...props} />,
                        table: ({ node, ...props }) => (
                          <div className="my-4 overflow-x-auto rounded-xl border border-slate-200">
                            <table className="min-w-full text-sm" {...props} />
                          </div>
                        ),
                        th: ({ node, ...props }) => <th className="bg-slate-50 px-3 py-2 text-left font-semibold text-slate-700" {...props} />,
                        td: ({ node, ...props }) => <td className="border-t border-slate-100 px-3 py-2 align-top" {...props} />,
                      }}
                    >
                      {content}
                    </ReactMarkdown>
                  </div>
                </div>
            </article>
          </div>
        )}
      </section>
    </div>
  );
}
