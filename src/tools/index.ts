import type { ToolName } from '../app';
import type { PlanView } from '../views/planView';
import { ColumnTool, DimensionTool, GridTool, OpeningTool, RoomTool, SketchTool, StairTool, WallTool } from './draw';
import { SelectTool } from './select';
import type { Tool } from './tool';

export function createTool(name: ToolName, view: PlanView): Tool {
  switch (name) {
    case 'select':
      return new SelectTool(view);
    case 'wall':
      return new WallTool(view);
    case 'door':
      return new OpeningTool(view, 'door');
    case 'window':
      return new OpeningTool(view, 'window');
    case 'floor':
      return new SketchTool(view, 'floor');
    case 'roof':
      return new SketchTool(view, 'roof');
    case 'room':
      return new RoomTool(view);
    case 'column':
      return new ColumnTool(view);
    case 'stair':
      return new StairTool(view);
    case 'dimension':
      return new DimensionTool(view);
    case 'grid':
      return new GridTool(view);
  }
}
