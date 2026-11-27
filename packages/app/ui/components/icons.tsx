import type { ComponentProps } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUp01Icon,
  ArrowUp02Icon,
  BookOpen01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  ComputerIcon,
  Copy01Icon,
  File01Icon,
  FileEditIcon,
  FileScriptIcon,
  Flag01Icon,
  FolderCodeIcon,
  GitBranchIcon,
  Globe02Icon,
  HelpCircleIcon,
  Idea01Icon,
  LinkSquare02Icon,
  Loading03Icon,
  Mortarboard02Icon,
  RefreshIcon,
  RotateClockwiseIcon,
  Search01Icon,
  SidebarRight01Icon,
  SidebarRightIcon,
  SparklesIcon,
  Tick02Icon,
  Wrench01Icon,
} from "@hugeicons/core-free-icons";

// The app's icons, from the Hugeicons free set (Stroke Rounded). Every icon is a component that takes SVG props, so
// call sites size it with `size-*` classes like any other SVG.

export type IconProps = Omit<ComponentProps<"svg">, "strokeWidth"> & { size?: number | string; strokeWidth?: number };

function icon(svg: IconSvgElement, name: string) {
  // Decorative unless the caller names it (the Spinner does).
  const Icon = (props: IconProps) => (
    <HugeiconsIcon icon={svg} strokeWidth={2} aria-hidden={props["aria-label"] ? undefined : true} {...(props as Omit<ComponentProps<typeof HugeiconsIcon>, "icon">)} />
  );
  Icon.displayName = name;
  return Icon;
}

export const AlertIcon = icon(Alert02Icon, "AlertIcon");
export const ArrowDownIcon = icon(ArrowDown02Icon, "ArrowDownIcon");
export const ArrowLeftIcon = icon(ArrowLeft02Icon, "ArrowLeftIcon");
export const ArrowRightIcon = icon(ArrowRight02Icon, "ArrowRightIcon");
export const ArrowUpIcon = icon(ArrowUp02Icon, "ArrowUpIcon");
export const BookIcon = icon(BookOpen01Icon, "BookIcon");
export const CheckIcon = icon(Tick02Icon, "CheckIcon");
export const ChevronDownIcon = icon(ArrowDown01Icon, "ChevronDownIcon");
export const ChevronLeftIcon = icon(ArrowLeft01Icon, "ChevronLeftIcon");
export const ChevronRightIcon = icon(ArrowRight01Icon, "ChevronRightIcon");
export const ChevronUpIcon = icon(ArrowUp01Icon, "ChevronUpIcon");
export const CircleAlertIcon = icon(AlertCircleIcon, "CircleAlertIcon");
export const CircleCheckIcon = icon(CheckmarkCircle02Icon, "CircleCheckIcon");
export const CodeFileIcon = icon(FileScriptIcon, "CodeFileIcon");
export const CopyIcon = icon(Copy01Icon, "CopyIcon");
export const EditFileIcon = icon(FileEditIcon, "EditFileIcon");
export const ExternalLinkIcon = icon(LinkSquare02Icon, "ExternalLinkIcon");
export const FileIcon = icon(File01Icon, "FileIcon");
export const FlagIcon = icon(Flag01Icon, "FlagIcon");
export const FolderIcon = icon(FolderCodeIcon, "FolderIcon");
export const BranchIcon = icon(GitBranchIcon, "BranchIcon");
export const GlobeIcon = icon(Globe02Icon, "GlobeIcon");
export const HelpIcon = icon(HelpCircleIcon, "HelpIcon");
export const HistoryIcon = icon(Clock01Icon, "HistoryIcon");
export const IdeaIcon = icon(Idea01Icon, "IdeaIcon");
export const LearnIcon = icon(Mortarboard02Icon, "LearnIcon");
export const LoaderIcon = icon(Loading03Icon, "LoaderIcon");
export const MonitorIcon = icon(ComputerIcon, "MonitorIcon");
export const ReloadIcon = icon(RefreshIcon, "ReloadIcon");
export const RetryIcon = icon(RotateClockwiseIcon, "RetryIcon");
export const SearchIcon = icon(Search01Icon, "SearchIcon");
export const SidebarCloseIcon = icon(SidebarRightIcon, "SidebarCloseIcon");
export const SidebarOpenIcon = icon(SidebarRight01Icon, "SidebarOpenIcon");
export const SparkleIcon = icon(SparklesIcon, "SparkleIcon");
export const ToolIcon = icon(Wrench01Icon, "ToolIcon");
