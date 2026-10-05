import { Show } from 'solid-js';
import type { GraphController } from '../render/controller';
import { ui } from '../state/ui';
import { Icon } from './icons';

/**
 * The graph's floating controls: one pill at the top right (the top-left corner stays free for
 * the graph itself). With the list hidden on a wide screen, the button that brings it back leads.
 * Zoom to fit joins zoom and reset once there are bounds to fit (src/plot/bounds.ts, with
 * auto-framing): a fit from the sampled curves alone would fly off to the poles of y = 1/x.
 */
export function GraphControls(props: {
  controller: GraphController;
  ref?: (el: HTMLDivElement) => void;
}) {
  return (
    <div class="graph-controls" ref={(el) => props.ref?.(el)}>
      <Show when={!ui.sidebarOpen()}>
        <button
          type="button"
          class="icon-button show-sidebar"
          aria-label="Show expression list"
          onClick={() => ui.setSidebarOpen(true)}
        >
          <Icon name="sidebar-show" />
        </button>
        <span class="graph-controls-divider show-sidebar" aria-hidden="true" />
      </Show>
      <button
        type="button"
        class="icon-button"
        aria-label="Zoom in"
        onClick={() => props.controller.zoomCenter(2)}
      >
        <Icon name="plus" />
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label="Zoom out"
        onClick={() => props.controller.zoomCenter(0.5)}
      >
        <Icon name="minus" />
      </button>
      <span class="graph-controls-divider" aria-hidden="true" />
      <button
        type="button"
        class="icon-button"
        aria-label="Reset view"
        onClick={() => props.controller.home()}
      >
        <Icon name="home" />
      </button>
    </div>
  );
}
