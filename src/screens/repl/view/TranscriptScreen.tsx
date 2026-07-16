import { AlternateScreen, type ScrollBoxHandle } from '@anthropic/ink';
import type React from 'react';
import { FullscreenLayout } from '../../../components/FullscreenLayout.js';
import { SandboxViolationExpandedView } from '../../../components/SandboxViolationExpandedView.js';
import { ScrollKeybindingHandler } from '../../../components/ScrollKeybindingHandler.js';
import type { JumpHandle } from '../../../components/VirtualMessageList.js';
import { CancelRequestHandler } from '../../../hooks/useCancelRequest.js';
import { CommandKeybindingHandlers } from '../../../hooks/useCommandKeybindings.js';
import { GlobalKeybindingHandlers } from '../../../hooks/useGlobalKeybindings.js';
import { KeybindingSetup } from '../../../keybindings/KeybindingProviderSetup.js';
import { isMouseTrackingEnabled } from '../../../utils/fullscreen.js';
import { AnimatedTerminalTitle, TranscriptModeFooter, TranscriptSearchBar } from './TranscriptChrome.js';

type Props = {
  titleIsAnimating: boolean;
  terminalTitle: string;
  titleDisabled: boolean;
  showStatusInTerminalTab: boolean;
  globalKeybindingProps: React.ComponentProps<typeof GlobalKeybindingHandlers>;
  onSubmit: React.ComponentProps<typeof CommandKeybindingHandlers>['onSubmit'];
  localJsxCommandActive: boolean;
  transcriptScrollRef: React.RefObject<ScrollBoxHandle | null> | undefined;
  scrollRef: React.RefObject<ScrollBoxHandle | null>;
  focusedInputDialog: string | undefined;
  searchOpen: boolean;
  jumpRef: React.MutableRefObject<JumpHandle | null>;
  cancelRequestProps: React.ComponentProps<typeof CancelRequestHandler>;
  transcriptMessagesElement: React.ReactNode;
  transcriptToolJSX: React.ReactNode;
  searchCount: number;
  searchCurrent: number;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
  setSearchCount: (count: number) => void;
  setSearchCurrent: (current: number) => void;
  setHighlight: (query: string) => void;
  showAllInTranscript: boolean;
  editorStatus: string | null;
  dumpMode: boolean;
};

export function TranscriptScreen({
  titleIsAnimating,
  terminalTitle,
  titleDisabled,
  showStatusInTerminalTab,
  globalKeybindingProps,
  onSubmit,
  localJsxCommandActive,
  transcriptScrollRef,
  scrollRef,
  focusedInputDialog,
  searchOpen,
  jumpRef,
  cancelRequestProps,
  transcriptMessagesElement,
  transcriptToolJSX,
  searchCount,
  searchCurrent,
  searchQuery,
  setSearchQuery,
  setSearchOpen,
  setSearchCount,
  setSearchCurrent,
  setHighlight,
  showAllInTranscript,
  editorStatus,
  dumpMode,
}: Props): React.ReactNode {
  const content = (
    <KeybindingSetup>
      <AnimatedTerminalTitle
        isAnimating={titleIsAnimating}
        title={terminalTitle}
        disabled={titleDisabled}
        noPrefix={showStatusInTerminalTab}
      />
      <GlobalKeybindingHandlers {...globalKeybindingProps} />
      <CommandKeybindingHandlers onSubmit={onSubmit} isActive={!localJsxCommandActive} />
      {transcriptScrollRef ? (
        <ScrollKeybindingHandler
          scrollRef={scrollRef}
          isActive={focusedInputDialog !== 'ultraplan-choice'}
          isModal={!searchOpen}
          onScroll={() => jumpRef.current?.disarmSearch()}
        />
      ) : null}
      <CancelRequestHandler {...cancelRequestProps} />
      {transcriptScrollRef ? (
        <FullscreenLayout
          scrollRef={scrollRef}
          scrollable={
            <>
              {transcriptMessagesElement}
              {transcriptToolJSX}
              <SandboxViolationExpandedView />
            </>
          }
          bottom={
            searchOpen ? (
              <TranscriptSearchBar
                jumpRef={jumpRef}
                initialQuery=""
                count={searchCount}
                current={searchCurrent}
                onClose={query => {
                  setSearchQuery(searchCount > 0 ? query : '');
                  setSearchOpen(false);
                  if (!query) {
                    setSearchCount(0);
                    setSearchCurrent(0);
                    jumpRef.current?.setSearchQuery('');
                  }
                }}
                onCancel={() => {
                  setSearchOpen(false);
                  jumpRef.current?.setSearchQuery('');
                  jumpRef.current?.setSearchQuery(searchQuery);
                  setHighlight(searchQuery);
                }}
                setHighlight={setHighlight}
              />
            ) : (
              <TranscriptModeFooter
                showAllInTranscript={showAllInTranscript}
                virtualScroll={true}
                status={editorStatus || undefined}
                searchBadge={
                  searchQuery && searchCount > 0 ? { current: searchCurrent, count: searchCount } : undefined
                }
              />
            )
          }
        />
      ) : (
        <>
          {transcriptMessagesElement}
          {transcriptToolJSX}
          <SandboxViolationExpandedView />
          <TranscriptModeFooter
            showAllInTranscript={showAllInTranscript}
            virtualScroll={false}
            suppressShowAll={dumpMode}
            status={editorStatus || undefined}
          />
        </>
      )}
    </KeybindingSetup>
  );

  return transcriptScrollRef ? (
    <AlternateScreen mouseTracking={isMouseTrackingEnabled()}>{content}</AlternateScreen>
  ) : (
    content
  );
}
