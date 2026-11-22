// Presentation state only. Never changes a game session or network state.
export function menuTransition(current, action, activeRound) {
  if (action === "escape" || action === "resume")
    return current === "playing" ? "menu" : "playing";
  if (action === "leave") return activeRound ? "confirm" : "closed";
  if (action === "confirm-leave")
    return current === "confirm" ? "closed" : current;
  if (action === "help") return "help";
  if (action === "menu") return "menu";
  return current;
}
