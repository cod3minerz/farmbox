import { useId, type ComponentType, type CSSProperties, type SVGProps } from "react";
import names from "./iconsax-names.json";
import glyphs from "./iconsax-glyphs.json";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };
type Glyph = keyof typeof glyphs;

function icon(name: Glyph): ComponentType<IconProps> {
  const { twotone, bulk } = glyphs[name];
  return function IconsaxIcon({ size = 24, className, style, ...props }) {
    const id = useId().replace(/[^a-zA-Z0-9_-]/g, "_");
    return <svg {...props} aria-hidden="true" focusable="false" data-icon={name} viewBox="0 0 24 24" fill="none"
      className={className ? "ui-icon " + className : "ui-icon"} style={{ ...style, "--icon-size": `${size / 16}rem` } as CSSProperties}>
      <g className="ui-icon-twotone" dangerouslySetInnerHTML={{ __html: twotone.replaceAll("ICON_ID_", id + "_idle_") }} />
      <g className="ui-icon-bulk" dangerouslySetInnerHTML={{ __html: bulk.replaceAll("ICON_ID_", id + "_active_") }} />
    </svg>;
  };
}

const icons = Object.fromEntries(Object.entries(names).map(([alias, name]) => [alias, icon(name as Glyph)])) as
  Record<keyof typeof names, ComponentType<IconProps>>;

export const {
  Activity,
  AiRecordVideo,
  AiSandTimer,
  ArrowUpRight,
  BatteryMedium,
  Braces,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  Clapperboard,
  Clock3,
  Command,
  FileVideo,
  FitCanvas,
  GalleryHorizontal,
  GitBranch,
  Globe,
  HardDrive,
  Home,
  LayoutDashboard,
  LayoutGrid,
  List,
  ListChecks,
  Maximize,
  Minimize,
  Minus,
  MirroringScreen,
  Monitor,
  MoreHorizontal,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Play,
  Plug,
  Plus,
  Radio,
  Save,
  ScanLine,
  Search,
  Send,
  Server,
  Settings2,
  Smartphone,
  Terminal,
  Trash2,
  Unplug,
  Upload,
  Video,
  Wifi,
  X,
} = icons;
