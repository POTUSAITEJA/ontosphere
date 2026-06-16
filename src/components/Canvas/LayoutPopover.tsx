import React from 'react';
import { Layout } from 'lucide-react';

interface LayoutPopoverProps {
  onToggle: () => void;
}

export const LayoutPopover: React.FC<LayoutPopoverProps> = ({ onToggle }) => (
  <button
    className="reactodia-btn reactodia-btn-default glass-btn"
    title="Layout settings"
    onClick={onToggle}
  >
    <Layout style={{ width: 14, height: 14 }} />
    <span>Layout</span>
  </button>
);
