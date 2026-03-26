import { useEffect, useRef, useState } from "react";
import type { TaskAnalyticsBucket } from "@opensprint/shared";

interface HelpAnalyticsChartProps {
  data: TaskAnalyticsBucket[];
  totalTasks: number;
}

const MARGIN = { top: 20, right: 50, bottom: 40, left: 60 };
const BAR_WIDTH_RATIO = 0.6;

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

/** Dual-axis chart: bars for avg completion time (left Y), line for task count (right Y), X = complexity 1–10 */
export function HelpAnalyticsChart({ data, totalTasks }: HelpAnalyticsChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });
  const [d3Module, setD3Module] = useState<typeof import("d3") | null>(null);

  useEffect(() => {
    import("d3").then((m) => setD3Module(m));
  }, []);

  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? { width: 600, height: 400 };
      setDimensions({ width: Math.max(200, width), height: Math.max(150, height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const d3 = d3Module;
    const svg = svgRef.current;
    if (!d3 || !svg || data.length === 0) return;

    const { width, height } = dimensions;
    const innerWidth = width - MARGIN.left - MARGIN.right;
    const innerHeight = height - MARGIN.top - MARGIN.bottom;

    d3.select(svg).selectAll("*").remove();

    const maxTime = Math.max(1, ...data.map((d) => d.avgCompletionTimeMs));
    const maxCount = Math.max(1, ...data.map((d) => d.taskCount));

    const xScale = d3
      .scaleBand()
      .domain(data.map((d) => String(d.complexity)))
      .range([0, innerWidth])
      .padding(0.2);

    const yTimeScale = d3.scaleLinear().domain([0, maxTime]).range([innerHeight, 0]);
    const yCountScale = d3.scaleLinear().domain([0, maxCount]).range([innerHeight, 0]);

    const g = d3
      .select(svg)
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    // Bars (avg completion time)
    const barWidth = (xScale.bandwidth() ?? 0) * BAR_WIDTH_RATIO;
    const barOffset = ((xScale.bandwidth() ?? 0) - barWidth) / 2;

    g.selectAll(".bar")
      .data(data)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => (xScale(String(d.complexity)) ?? 0) + barOffset)
      .attr("y", (d) => yTimeScale(d.avgCompletionTimeMs))
      .attr("width", barWidth)
      .attr("height", (d) => innerHeight - yTimeScale(d.avgCompletionTimeMs))
      .attr("fill", "var(--ui-accent-primary)")
      .attr("opacity", 0.8);

    // Line (task count)
    const line = d3
      .line<TaskAnalyticsBucket>()
      .x((d) => (xScale(String(d.complexity)) ?? 0) + (xScale.bandwidth() ?? 0) / 2)
      .y((d) => yCountScale(d.taskCount));

    g.append("path")
      .datum(data)
      .attr("class", "line")
      .attr("fill", "none")
      .attr("stroke", "var(--ui-text-primary)")
      .attr("stroke-width", 2)
      .attr("stroke-linecap", "round")
      .attr("stroke-linejoin", "round")
      .attr("d", line);

    g.selectAll(".line-dot")
      .data(data)
      .join("circle")
      .attr("class", "line-dot")
      .attr("cx", (d) => (xScale(String(d.complexity)) ?? 0) + (xScale.bandwidth() ?? 0) / 2)
      .attr("cy", (d) => yCountScale(d.taskCount))
      .attr("r", 4)
      .attr("fill", "var(--ui-text-primary)");

    // X axis
    g.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(d3.axisBottom(xScale).tickFormat((v) => v))
      .attr("color", "var(--ui-text-secondary)")
      .selectAll("text")
      .attr("font-size", "11px");

    // Left Y axis (completion time)
    g.append("g")
      .call(
        d3
          .axisLeft(yTimeScale)
          .ticks(5)
          .tickFormat((v) => formatDuration(Number(v)))
      )
      .attr("color", "var(--ui-text-secondary)")
      .selectAll("text")
      .attr("font-size", "10px");

    // Right Y axis (task count)
    g.append("g")
      .attr("transform", `translate(${innerWidth},0)`)
      .call(d3.axisRight(yCountScale).ticks(5))
      .attr("color", "var(--ui-text-secondary)")
      .selectAll("text")
      .attr("font-size", "10px");

    return () => {
      d3.select(svg).selectAll("*").remove();
    };
  }, [d3Module, data, dimensions]);

  if (data.length === 0 || totalTasks === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-theme-muted text-sm">
        <p>No completed tasks with complexity data yet.</p>
        <p className="mt-1">Complete tasks with complexity 1–10 to see analytics.</p>
      </div>
    );
  }

  if (!d3Module) {
    return (
      <div data-testid="help-analytics-chart" className="text-theme-muted text-sm py-12 text-center">
        Loading chart…
      </div>
    );
  }

  return (
    <div data-testid="help-analytics-chart">
      <div className="w-full h-[400px]">
        <svg ref={svgRef} className="w-full h-full" aria-label="Task analytics by complexity" />
      </div>
      <div className="flex gap-6 mt-2 text-xs text-theme-muted">
        <span>
          <span className="inline-block w-3 h-3 rounded-sm bg-accent-primary opacity-80 mr-1" />
          Avg completion time (left axis)
        </span>
        <span>
          <span className="inline-block w-3 h-3 border-2 border-theme-text rounded-full mr-1" />
          Task count (right axis)
        </span>
      </div>
      <p className="mt-2 text-xs text-theme-muted">
        Based on {totalTasks} most recent completed tasks
      </p>
    </div>
  );
}
