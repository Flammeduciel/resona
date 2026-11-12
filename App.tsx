import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Dimensions, Easing, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Resona } from './src/native';
import { DetailScreen } from './src/screens/DetailScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { RecorderScreen } from './src/screens/RecorderScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { useTheme } from './src/theme';
import { ToastProvider } from './src/ui/kit';

type Route =
  | { name: 'home' }
  | { name: 'record'; id: string }
  | { name: 'detail'; id: string; autoAnalyze?: boolean }
  | { name: 'settings' };

type Entry = { key: number; route: Route; anim: Animated.Value };

const W = Dimensions.get('window').width;
let nextKey = 1;

/** Pile d'écrans avec transitions glissées (l'écran du dessous recule légèrement, comme sur iOS). */
function Navigator() {
  const t = useTheme();
  const [stack, setStack] = useState<Entry[]>([{ key: 0, route: { name: 'home' }, anim: new Animated.Value(1) }]);
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const animating = useRef(false);

  const push = useCallback((route: Route) => {
    const anim = new Animated.Value(0);
    setStack(s => [...s, { key: nextKey++, route, anim }]);
    Animated.timing(anim, { toValue: 1, duration: 340, easing: Easing.bezier(0.2, 0.9, 0.25, 1), useNativeDriver: true }).start();
  }, []);

  const replace = useCallback((route: Route) => {
    const anim = new Animated.Value(1);
    setStack(s => [...s.slice(0, -1), { key: nextKey++, route, anim }]);
  }, []);

  const back = useCallback(() => {
    const s = stackRef.current;
    if (s.length <= 1 || animating.current) return;
    animating.current = true;
    const top = s[s.length - 1];
    Animated.timing(top.anim, { toValue: 0, duration: 260, easing: Easing.bezier(0.4, 0, 0.6, 1), useNativeDriver: true }).start(() => {
      setStack(cur => cur.filter(e => e.key !== top.key));
      animating.current = false;
    });
  }, []);

  useEffect(() => {
    Resona.getRecorderState().then(st => {
      if (st.active && st.id) push({ name: 'record', id: st.id });
    });
  }, [push]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stackRef.current.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [back]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {stack.map((e, i) => {
        const above = stack[i + 1];
        const isTop = i === stack.length - 1;
        // visible : l'écran du dessus, et celui juste dessous pendant une transition
        const translateX = Animated.add(
          e.anim.interpolate({ inputRange: [0, 1], outputRange: [i === 0 ? 0 : W, 0] }),
          above ? above.anim.interpolate({ inputRange: [0, 1], outputRange: [0, -W * 0.28] }) : 0,
        );
        return (
          <Animated.View
            key={e.key}
            pointerEvents={isTop ? 'auto' : 'none'}
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: t.bg,
                transform: [{ translateX }],
                elevation: i * 2,
                shadowColor: '#000',
                shadowOpacity: 0.12,
                shadowRadius: 12,
              },
            ]}>
            <Screen route={e.route} focused={isTop} push={push} replace={replace} back={back} />
            {above ? (
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: above.anim.interpolate({ inputRange: [0, 1], outputRange: [0, t.dark ? 0.5 : 0.12] }) }]} />
            ) : null}
          </Animated.View>
        );
      })}
    </View>
  );
}

function Screen({ route, focused, push, replace, back }: { route: Route; focused: boolean; push: (r: Route) => void; replace: (r: Route) => void; back: () => void }) {
  switch (route.name) {
    case 'home':
      return <HomeScreen focused={focused} onOpen={id => push({ name: 'detail', id })} onRecord={id => push({ name: 'record', id })} onSettings={() => push({ name: 'settings' })} />;
    case 'record':
      return <RecorderScreen id={route.id} onBack={back} onDone={id => replace({ name: 'detail', id, autoAnalyze: true })} />;
    case 'detail':
      return <DetailScreen id={route.id} autoAnalyze={route.autoAnalyze} onBack={back} onSettings={() => push({ name: 'settings' })} />;
    case 'settings':
      return <SettingsScreen onBack={back} />;
  }
}

function Root() {
  const t = useTheme();
  return (
    <>
      <StatusBar barStyle={t.dark ? 'light-content' : 'dark-content'} />
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
        <ToastProvider>
          <Navigator />
        </ToastProvider>
      </SafeAreaView>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}
