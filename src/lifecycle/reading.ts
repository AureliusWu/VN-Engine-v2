export type ReadingConditions = {
  visible: boolean; panelOpen: boolean; interfaceHidden: boolean; manualPause: boolean;
};
/** The host owns visibility/panels. Every automatic timer consults this gate. */
export function canRead(state: ReadingConditions): boolean {
  return state.visible && !state.panelOpen && !state.interfaceHidden && !state.manualPause;
}
export function canAutoAdvance(state: ReadingConditions, finished: boolean, voiceBlocked: boolean, awaitsChoice: boolean): boolean {
  return canRead(state) && finished && !voiceBlocked && !awaitsChoice;
}

/** Same paragraph can be loaded again; visits distinguish late media callbacks. */
export class ReadingVisit {
  private generation = 0;
  enter(position: string): string { return `${++this.generation}:${position}`; }
}
