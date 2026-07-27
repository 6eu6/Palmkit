/**
 * Workspace UI Kit
 *
 * Mobile-first AI developer workspace design system components.
 * These components are designed to be incrementally integrated
 * without breaking existing functionality.
 */

// Shell
export { WorkspaceShell } from './AIWorkspaceShell';

// Status indicators
export { AgentStatusPill, type AgentStatus } from './AgentStatusPill';
export { ThinkingBubble } from './ThinkingBubble';
export { GenerationStepTimeline } from './GenerationStepTimeline';

// Cards
export { FileCreatedCard, type FileCreatedStatus } from './FileCreatedCard';
export { RestoreSnapshotCard, type RestoreSnapshotStatus } from './RestoreSnapshotCard';

// Navigation
export { MobileActionDock } from './MobileActionDock';
export { ProjectSwitcherDrawer } from './ProjectSwitcherDrawer';

// Input
export { ComposerBar } from './ComposerBar';

// Empty states
export { EmptyWorkspaceState } from './EmptyWorkspaceState';
