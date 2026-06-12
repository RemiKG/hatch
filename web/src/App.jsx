import React, { useState } from 'react';
import { Brand } from './components/Brand.jsx';

const SCREENS = ['point', 'sample', 'fields', 'dashboard'];

export default function App() {
  const [screen, setScreen] = useState('point');
  return (
    <div className="app">
      <header className="topbar"><Brand /></header>
      <main className="stage">
        <p className="muted">screen: {screen}</p>
      </main>
    </div>
  );
}
