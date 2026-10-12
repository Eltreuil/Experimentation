import type { ToolName } from '../app';
import type { PlanView } from '../views/planView';
import {
  ColumnTool,
  ComponentTool,
  DimensionTool,
  GridTool,
  OpeningTool,
  RoomTool,
  SectionTool,
  SketchTool,
  StairTool,
  TextTool,
  WallDimensionTool,
  WallTool,
} from './draw';
import { AlignTool, MeasureTool, OffsetTool, SplitTool, TransformTool, TrimTool } from './modify';
import { SelectTool } from './select';
import type { Tool } from './tool';

export function createTool(name: ToolName, view: PlanView): Tool {
  const roomAuto = view.app.options.roomMode === 'auto';
  switch (name) {
    case 'select':
      return new SelectTool(view);
    case 'wall':
      return new WallTool(view);
    case 'door':
    case 'window':
    case 'opening':
      return new OpeningTool(view, name);
    case 'floor':
    case 'roof':
    case 'shaft':
    case 'railing':
      return new SketchTool(view, name);
    case 'room':
      return new RoomTool(view, 'room');
    case 'ceiling':
      return roomAuto ? new RoomTool(view, 'ceiling') : new SketchTool(view, 'ceiling');
    case 'column':
      return new ColumnTool(view);
    case 'component':
      return new ComponentTool(view);
    case 'stair':
      return new StairTool(view);
    case 'dimension':
      return new DimensionTool(view);
    case 'wallDimension':
      return new WallDimensionTool(view);
    case 'grid':
      return new GridTool(view);
    case 'text':
      return new TextTool(view);
    case 'section':
      return new SectionTool(view);
    case 'measure':
      return new MeasureTool(view);
    case 'align':
      return new AlignTool(view);
    case 'offset':
      return new OffsetTool(view);
    case 'trim':
      return new TrimTool(view, 'corner');
    case 'extend':
      return new TrimTool(view, 'single');
    case 'split':
      return new SplitTool(view);
    case 'move':
    case 'copy':
    case 'rotate':
    case 'mirror':
    case 'array':
      return new TransformTool(view, name);
  }
}
