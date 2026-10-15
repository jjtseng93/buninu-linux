// Report the content area in the same pixel units as SGR 1016, not fb margins.
export function attachGeometry({ term, renderer, reply }) {
  term.options.windowOptions = { ...term.options.windowOptions, getWinSizePixels: true, getCellSizePixels: true };
  return term.parser.registerCsiHandler({ final: 't' }, params => {
    if (params[0] === 14 && params[1] !== 2) {
      reply(`\x1b[4;${Math.round(term.rows * renderer.cellHeight)};${Math.round(term.cols * renderer.cellWidth)}t`);
      return true;
    }
    if (params[0] === 16) {
      reply(`\x1b[6;${Math.round(renderer.cellHeight)};${Math.round(renderer.cellWidth)}t`);
      return true;
    }
    return false;
  });
}
