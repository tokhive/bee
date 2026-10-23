import React from 'react';
import { createRoot } from 'react-dom/client';
import { P0Page } from './P0Page';
import './p0.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><P0Page /></React.StrictMode>);
