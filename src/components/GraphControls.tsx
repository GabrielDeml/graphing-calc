import type { GraphController } from '../render/controller';

export function GraphControls(props: { controller: GraphController }) {
  return (
    <div class="graph-controls">
      <button
        type="button"
        class="icon-button"
        aria-label="Zoom in"
        onClick={() => props.controller.zoomCenter(2)}
      >
        +
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label="Zoom out"
        onClick={() => props.controller.zoomCenter(0.5)}
      >
        −
      </button>
      <button
        type="button"
        class="icon-button"
        aria-label="Reset view"
        onClick={() => props.controller.home()}
      >
        ⌂
      </button>
    </div>
  );
}
