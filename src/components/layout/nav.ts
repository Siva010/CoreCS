import {
  Activity,
  Cpu,
  Database,
  FlaskConical,
  House,
  Layers,
  MessagesSquare,
  Network,
  RotateCcw,
  Route,
  Siren,
  SquareTerminal,
  TriangleAlert,
  ChartColumn,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import type { SubjectId } from "@/lib/content/types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  subject?: SubjectId;
  track?: "sql";
}

export const NAV_SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "Home", icon: House },
      { href: "/path", label: "Learning Path", icon: Route },
    ],
  },
  {
    title: "Subjects",
    items: [
      { href: "/os", label: "Operating Systems", icon: Cpu, subject: "os" },
      { href: "/networks", label: "Computer Networks", icon: Network, subject: "cn" },
      { href: "/databases", label: "Databases", icon: Database, subject: "db" },
      { href: "/databases/sql", label: "SQL", icon: SquareTerminal, subject: "db", track: "sql" },
      { href: "/connections", label: "Cross-Domain", icon: Waypoints, subject: "x" },
    ],
  },
  {
    title: "Practice",
    items: [
      { href: "/interview", label: "Interview Mode", icon: MessagesSquare },
      { href: "/labs", label: "Labs", icon: FlaskConical },
      { href: "/visualizations", label: "Visualizations", icon: Activity },
      { href: "/traps", label: "Interview Traps", icon: TriangleAlert },
    ],
  },
  {
    title: "Go deeper",
    items: [
      { href: "/under-the-hood", label: "Under the Hood", icon: Layers },
      { href: "/case-studies", label: "Case Studies", icon: Siren },
    ],
  },
  {
    title: "You",
    items: [
      { href: "/revision", label: "Revision", icon: RotateCcw },
      { href: "/progress", label: "Progress", icon: ChartColumn },
    ],
  },
];
