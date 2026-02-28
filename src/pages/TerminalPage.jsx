export function TerminalPage({ ttydUrl }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">终端</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">连接 TTYD：{ttydUrl}</p>
        </div>
        <a
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          href={ttydUrl}
          rel="noreferrer"
          target="_blank"
        >
          新窗口打开
        </a>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <iframe
          className="h-[74vh] w-full bg-black"
          src={ttydUrl}
          title="TTYD 终端"
        />
      </div>
    </section>
  )
}
