import { useNavigate } from "react-router";
import { routes, type RouteName } from "../routes";

export function useAppNavigate() {
  const navigate = useNavigate();
  return {
    goTo: (path: string) => navigate(path),
    goToRoute: (name: RouteName) => navigate(routes[name]),
    goHome: () => navigate(routes.home),
    goToAbout: () => navigate(routes.about),
    goToSettings: () => navigate(routes.settings),
  };
}
