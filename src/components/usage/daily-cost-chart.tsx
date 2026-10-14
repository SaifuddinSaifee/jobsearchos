"use client";

import type { EChartsCoreOption } from "echarts/core";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAxisUsd, formatCount, formatDay, formatUsd, niceTicks } from "@/lib/usage/format";
import type { DayRow } from "@/lib/usage/metrics";

/**
 * The theme colors ECharts needs, as rgb. The app's tokens are oklch(), which ECharts' color parser does not reliably
 * understand, so each is resolved through the browser (a probe element for the variable, a one-pixel canvas to convert).
 */
function resolveColors() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const resolve = (token: string) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${token})`;
    document.body.appendChild(probe);
    const css = getComputedStyle(probe).color;
    probe.remove();
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  };
  return {
    bar: resolve("--chart-2"),
    barHover: resolve("--foreground"),
    grid: resolve("--border"),
    text: resolve("--muted-foreground"),
    surface: resolve("--popover"),
    ink: resolve("--popover-foreground"),
    wash: resolve("--muted"),
  };
}

type Colors = ReturnType<typeof resolveColors>;

function buildOption(days: DayRow[], c: Colors): EChartsCoreOption {
  const { top, step } = niceTicks(Math.max(...days.map((d) => d.costUsd)));
  // Every other day for a week, otherwise about five labels; both ends are always labeled.
  const shown = new Set(
    days.length <= 7 ? days.map((_, i) => i).filter((i) => i % 2 === 0) : [0, 1, 2, 3, 4].map((i) => Math.round((i * (days.length - 1)) / 4)),
  );

  return {
    animation: false,
    aria: { enabled: true },
    grid: { left: 8, right: 8, top: 12, bottom: 4, containLabel: true },
    xAxis: {
      type: "category",
      data: days.map((d) => formatDay(d.date)),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: c.grid } },
      axisLabel: { color: c.text, fontSize: 12, interval: (i: number) => shown.has(i), hideOverlap: true, margin: 10 },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: top,
      interval: step,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: c.text, fontSize: 12, formatter: (v: number) => formatAxisUsd(v, step) },
      splitLine: { lineStyle: { color: c.grid, type: "solid", width: 1 } },
    },
    tooltip: {
      trigger: "axis",
      // Under the bars (z 1, series are 2): drawn on top, the band washes out the bar being hovered.
      axisPointer: { type: "shadow", z: 1, shadowStyle: { color: c.wash, opacity: 0.6 } },
      backgroundColor: c.surface,
      borderColor: c.grid,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: c.ink },
      extraCssText: "border-radius: 8px; box-shadow: 0 4px 12px rgb(0 0 0 / 0.08);",
      // Only numbers and a date string we format ourselves go in here, so there is nothing to escape.
      formatter: (params: unknown) => {
        const d = days[(params as { dataIndex: number }[])[0].dataIndex];
        const muted = `color:${c.text};font-size:12px`;
        return (
          `<div style="${muted}">${formatDay(d.date)}</div>` +
          `<div style="font-size:16px;font-weight:600">${formatUsd(d.costUsd)}</div>` +
          `<div style="${muted}">${formatCount(d.calls)} ${d.calls === 1 ? "call" : "calls"}${d.errors > 0 ? `, ${d.errors} failed` : ""}</div>`
        );
      },
    },
    series: [
      {
        type: "bar",
        data: days.map((d) => d.costUsd),
        barMaxWidth: 24,
        barCategoryGap: "25%",
        // Rounded at the data end, square on the baseline.
        itemStyle: { color: c.bar, borderRadius: [4, 4, 0, 0] },
        emphasis: { itemStyle: { color: c.barHover } },
      },
    ],
  };
}

/**
 * Spend per day as columns, drawn with Apache ECharts. One series, so no legend: the card title names it. Hovering a
 * day shows its cost and call count. The table view carries the same numbers for anyone who cannot or will not hover,
 * which a canvas chart cannot offer on its own.
 */
export function DailyCostChart({ days, timeZone }: { days: DayRow[]; timeZone: string }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const host = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  const peak = days.reduce<DayRow | undefined>((best, d) => (d.costUsd > (best?.costUsd ?? 0) ? d : best), undefined);

  // ECharts runs only in the browser and is fetched on demand, so it stays out of the server render and out of every
  // other page's bundle. Rebuilt when the data or the light/dark theme changes.
  useEffect(() => {
    const el = host.current;
    if (view !== "chart" || !el) return;
    let cancelled = false;
    let dispose = () => {};
    void (async () => {
      const [core, charts, components, renderers] = await Promise.all([
        import("echarts/core"),
        import("echarts/charts"),
        import("echarts/components"),
        import("echarts/renderers"),
      ]);
      if (cancelled) return;
      core.use([charts.BarChart, components.GridComponent, components.TooltipComponent, components.AriaComponent, renderers.CanvasRenderer]);
      const chart = core.init(el);
      chart.setOption(buildOption(days, resolveColors()));
      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(el);
      dispose = () => {
        observer.disconnect();
        chart.dispose();
      };
    })();
    return () => {
      cancelled = true;
      dispose();
    };
  }, [view, days, resolvedTheme]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {peak ? `Peak ${formatUsd(peak.costUsd)} on ${formatDay(peak.date)}. Days are in ${timeZone}.` : "No spend in this period."}
        </p>
        <div className="flex gap-1" role="group" aria-label="Chart view">
          {(["chart", "table"] as const).map((v) => (
            <Button key={v} type="button" size="sm" variant={view === v ? "secondary" : "ghost"} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "chart" ? "Chart" : "Table"}
            </Button>
          ))}
        </div>
      </div>

      {view === "chart" ? (
        // The keys matter: ECharts owns the chart host's DOM and clears it on dispose, so React must not reuse that
        // element for the table.
        <div key="chart" ref={host} role="img" aria-label="Spend per day" className="h-56 w-full animate-in fade-in duration-300 motion-reduce:animate-none" />
      ) : (
        <div key="table" className="max-h-72 animate-in overflow-y-auto rounded-lg border fade-in duration-300 motion-reduce:animate-none">
          <Table>
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead className="pl-4">Day</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="pr-4 text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...days]
                .reverse()
                .filter((d) => d.calls > 0)
                .map((d) => (
                  <TableRow key={d.date}>
                    <TableCell className="pl-4">{formatDay(d.date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCount(d.calls)}</TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">{d.errors || "-"}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{formatUsd(d.costUsd)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">Days with no calls are left out.</p>
        </div>
      )}
    </div>
  );
}
