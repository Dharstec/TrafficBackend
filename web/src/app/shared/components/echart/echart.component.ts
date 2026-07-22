import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild } from '@angular/core';
import * as echarts from 'echarts';

// Thin ECharts wrapper: dashboard components stay UI-only and hand this
// component a fully-resolved EChartsOption. Resize is handled here via
// ResizeObserver so charts stay correct inside a fluid Tailwind grid, and
// `notMerge: true` on every setOption() keeps light/dark option swaps
// (built fresh in the parent per theme) from bleeding stale series config.
@Component({
  selector: 'app-echart',
  templateUrl: './echart.component.html',
  styleUrls: ['./echart.component.scss'],
})
export class EchartComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() option: echarts.EChartsOption | null = null;
  @Input() height = '260px';
  @ViewChild('chartHost', { static: true }) chartHost!: ElementRef<HTMLDivElement>;

  private chart?: echarts.ECharts;
  private resizeObserver?: ResizeObserver;

  ngAfterViewInit() {
    this.chart = echarts.init(this.chartHost.nativeElement);
    if (this.option) this.chart.setOption(this.option, true);

    this.resizeObserver = new ResizeObserver(() => this.chart?.resize());
    this.resizeObserver.observe(this.chartHost.nativeElement);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['option'] && this.chart && this.option) {
      this.chart.setOption(this.option, true);
    }
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    this.chart?.dispose();
  }
}
