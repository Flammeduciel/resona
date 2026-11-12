import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'play'
  | 'pause'
  | 'stop'
  | 'back15'
  | 'fwd15'
  | 'chevronLeft'
  | 'chevronRight'
  | 'share'
  | 'download'
  | 'gear'
  | 'search'
  | 'more'
  | 'trash'
  | 'pencil'
  | 'mic'
  | 'waveform'
  | 'person'
  | 'people'
  | 'doc'
  | 'music'
  | 'check'
  | 'close'
  | 'merge'
  | 'sparkles'
  | 'headphones'
  | 'refresh';

/** Icônes au trait, dans l'esprit des SF Symbols. */
export function Icon({ name, size = 22, color = '#000', strokeWidth = 1.9 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const f = { fill: color };
  let c: React.ReactNode;
  switch (name) {
    case 'play':
      c = <Path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2c.6-.4.6-1.3 0-1.7L8.6 3.9C7.9 3.5 7 4 7 4.8z" {...f} />;
      break;
    case 'pause':
      c = (
        <>
          <Rect x="5.5" y="4" width="4.6" height="16" rx="1.4" {...f} />
          <Rect x="13.9" y="4" width="4.6" height="16" rx="1.4" {...f} />
        </>
      );
      break;
    case 'stop':
      c = <Rect x="5" y="5" width="14" height="14" rx="3" {...f} />;
      break;
    case 'back15':
      c = (
        <>
          <Path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" {...p} />
          <Path d="M4 4v4.5h4.5" {...p} />
          <Path d="M10 10.2l1.3-.9v5.5M13.6 9.3h2.6M13.7 9.3l-.3 2.6c.4-.3.9-.4 1.4-.3a1.5 1.5 0 0 1 0 3c-.6.1-1.2-.2-1.5-.6" {...p} strokeWidth={1.4} />
        </>
      );
      break;
    case 'fwd15':
      c = (
        <>
          <Path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" {...p} />
          <Path d="M20 4v4.5h-4.5" {...p} />
          <Path d="M8.6 10.2l1.3-.9v5.5M12.2 9.3h2.6M12.3 9.3l-.3 2.6c.4-.3.9-.4 1.4-.3a1.5 1.5 0 0 1 0 3c-.6.1-1.2-.2-1.5-.6" {...p} strokeWidth={1.4} />
        </>
      );
      break;
    case 'chevronLeft':
      c = <Path d="M15 4.5L7.5 12l7.5 7.5" {...p} strokeWidth={2.4} />;
      break;
    case 'chevronRight':
      c = <Path d="M9 4.5l7.5 7.5L9 19.5" {...p} strokeWidth={2.2} />;
      break;
    case 'share':
      c = (
        <>
          <Path d="M12 3v12M7.8 7.2L12 3l4.2 4.2" {...p} />
          <Path d="M8 10.5H6.5a1.5 1.5 0 0 0-1.5 1.5v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5H16" {...p} />
        </>
      );
      break;
    case 'download':
      c = (
        <>
          <Path d="M12 3.5v11.5M7.8 10.8L12 15l4.2-4.2" {...p} />
          <Path d="M4.5 16.5v2A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5v-2" {...p} />
        </>
      );
      break;
    case 'gear':
      c = (
        <>
          <Circle cx="12" cy="12" r="3" {...p} />
          <Path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
            {...p}
            strokeWidth={1.6}
          />
        </>
      );
      break;
    case 'search':
      c = (
        <>
          <Circle cx="10.5" cy="10.5" r="6.5" {...p} />
          <Path d="M15.5 15.5L20.5 20.5" {...p} />
        </>
      );
      break;
    case 'more':
      c = (
        <>
          <Circle cx="5.5" cy="12" r="1.7" {...f} />
          <Circle cx="12" cy="12" r="1.7" {...f} />
          <Circle cx="18.5" cy="12" r="1.7" {...f} />
        </>
      );
      break;
    case 'trash':
      c = (
        <>
          <Path d="M4 6.5h16M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7" {...p} />
          <Path d="M6 6.5l.9 12.6c.1 1 .9 1.9 2 1.9h6.2c1.1 0 1.9-.9 2-1.9L18 6.5M10 10.5v6.5M14 10.5v6.5" {...p} />
        </>
      );
      break;
    case 'pencil':
      c = <Path d="M16.5 3.8a2.1 2.1 0 0 1 3 3L8 18.3 3.5 19.5 4.7 15 16.5 3.8z" {...p} />;
      break;
    case 'mic':
      c = (
        <>
          <Rect x="8.5" y="2.5" width="7" height="12" rx="3.5" {...p} />
          <Path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" {...p} />
        </>
      );
      break;
    case 'waveform':
      c = <Path d="M3 12h1M6.5 8.5v7M10 5v14M13.5 8v8M17 10v4M20.5 11.5v1" {...p} />;
      break;
    case 'person':
      c = (
        <>
          <Circle cx="12" cy="8" r="4" {...p} />
          <Path d="M4.5 20.5c.8-3.6 3.9-5.5 7.5-5.5s6.7 1.9 7.5 5.5" {...p} />
        </>
      );
      break;
    case 'people':
      c = (
        <>
          <Circle cx="9" cy="8.5" r="3.5" {...p} />
          <Path d="M2.5 19.5c.7-3 3.4-4.8 6.5-4.8s5.8 1.8 6.5 4.8" {...p} />
          <Path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6M18 14.9c1.8.6 3.1 2.2 3.5 4.6" {...p} />
        </>
      );
      break;
    case 'doc':
      c = (
        <>
          <Path d="M14 3H7.5A2.5 2.5 0 0 0 5 5.5v13A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V8l-5-5z" {...p} />
          <Path d="M14 3v5h5M8.5 13h7M8.5 16.5h5" {...p} />
        </>
      );
      break;
    case 'music':
      c = (
        <>
          <Path d="M9 18V5.5l11-2.5v12.5" {...p} />
          <Circle cx="6.5" cy="18" r="2.5" {...p} />
          <Circle cx="17.5" cy="15.5" r="2.5" {...p} />
        </>
      );
      break;
    case 'check':
      c = <Path d="M4.5 12.5l5 5L19.5 6.5" {...p} strokeWidth={2.4} />;
      break;
    case 'close':
      c = <Path d="M6 6l12 12M18 6L6 18" {...p} strokeWidth={2.2} />;
      break;
    case 'merge':
      c = <Path d="M6 3.5v4.5a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v4.5M18 3.5V8a4 4 0 0 1-2 3.4M15 17.5l3 3 3-3" {...p} />;
      break;
    case 'sparkles':
      c = <Path d="M10 3.5l1.6 4.4L16 9.5l-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6L10 3.5zM17.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" {...p} strokeWidth={1.6} />;
      break;
    case 'headphones':
      c = (
        <>
          <Path d="M4 15v-3a8 8 0 0 1 16 0v3" {...p} />
          <Rect x="3" y="14" width="4.5" height="7" rx="1.8" {...p} />
          <Rect x="16.5" y="14" width="4.5" height="7" rx="1.8" {...p} />
        </>
      );
      break;
    case 'refresh':
      c = (
        <>
          <Path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" {...p} />
          <Path d="M20 4v4.5h-4.5" {...p} />
        </>
      );
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {c}
    </Svg>
  );
}
