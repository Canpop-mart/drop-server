/**
 * Launch auto-detection scoring helpers.
 *
 * Executable candidates are ranked by a fuzzy match between their basename and
 * the game name. That alone lets a non-game executable shipped alongside the
 * real one (a crash handler, a redistributable installer, an engine prereq)
 * win when its name happens to score higher. This demotes those known cases so
 * the actual game executable ranks first. It only lowers a score; if a junk
 * name is the *only* candidate for a platform it is still picked.
 */

/** Executables that ship next to games but are never the game itself. */
const NON_GAME_EXE =
  /(unitycrashhandler|crashreportclient|ueprereqsetup|prereq|vc_?redist|dxsetup|dxwebsetup|directx|oalinst|dotnet|unins|^setup\.exe$|^install\.exe$|^vcredist)/i;

/**
 * Adjust a fuzzy name-match score to demote known non-game executables, so the
 * real game binary outranks installers/crash handlers/prereqs.
 */
export function launchScore(fuzzyValue: number, basename: string): number {
  return NON_GAME_EXE.test(basename) ? fuzzyValue - 1 : fuzzyValue;
}
