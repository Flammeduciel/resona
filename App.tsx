import React, { useEffect, useState } from 'react';
import { BackHandler, StatusBar, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Resona } from './src/native';
import { DetailScreen } from './src/screens/DetailScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { RecorderScreen } from './src/screens/RecorderScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { C } from './src/theme';

type Route = { name: 'home' } | { name: 'record'; id: string } | { name: 'detail'; id: string } | { name: 'settings' };

export default function App() {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const route = stack[stack.length - 1];

  const push = (r: Route) => setStack(s => [...s, r]);
  const replace = (r: Route) => setStack(s => [...s.slice(0, -1), r]);
  const back = () => setStack(s => (s.length > 1 ? s.slice(0, -1) : s));

  // Si un enregistrement tourne déjà (appli rouverte), on y retourne directement.
  useEffect(() => {
    Resona.getRecorderState().then(st => {
      if (st.active && st.id) push({ name: 'record', id: st.id });
    });
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
        <View style={{ flex: 1 }} key={stack.length + route.name}>
          {route.name === 'home' && (
            <HomeScreen
              onOpen={id => push({ name: 'detail', id })}
              onRecord={id => push({ name: 'record', id })}
              onSettings={() => push({ name: 'settings' })}
            />
          )}
          {route.name === 'record' && (
            <RecorderScreen id={route.id} onBack={back} onDone={id => replace({ name: 'detail', id })} />
          )}
          {route.name === 'detail' && (
            <DetailScreen id={route.id} onBack={back} onSettings={() => push({ name: 'settings' })} />
          )}
          {route.name === 'settings' && <SettingsScreen onBack={back} />}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
