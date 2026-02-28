import type React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'icon' | 'compact';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  type?: 'button' | 'submit' | 'reset';
  disabled?: boolean;
  'aria-label'?: string;
  title?: string;
}

const BASE_CLASSES =
  'rounded-xl font-medium transition-all duration-100 active:scale-[0.97] focus-visible:outline-none ' +
  'flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:ring-2 focus-visible:ring-accent-edge';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'h-10 px-3 py-3.5 text-[16px] border bg-accent-soft border-accent-edge text-accent hover:opacity-90',
  secondary:
    'h-10 px-3 py-3.5 text-[16px] border bg-input border-transparent text-mid hover:text-hi hover:bg-input',
  danger:
    'h-10 px-3 py-3.5 text-[16px] border bg-err-soft border-err-edge text-err hover:opacity-90',
  icon:
    'h-8 w-8 p-0 rounded-xl flex items-center justify-center border bg-input border-transparent',
  compact:
    'h-9 px-3 text-[12px] border bg-input border-transparent text-mid',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 text-[13px] px-2',
  md: '',
  lg: 'h-11 px-4',
};

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

export default function Button({
  variant = 'secondary',
  size,
  leftIcon,
  rightIcon,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  if (variant === 'icon' && !children && !rest['aria-label']) {
    console.error('Button: aria-label is required for icon-only buttons.');
  }

  const resolvedSizeClass = size ? SIZE_CLASSES[size] : '';
  const applySizeClass = variant === 'icon' ? '' : resolvedSizeClass;

  return (
    <button
      type={type}
      className={cx(BASE_CLASSES, VARIANT_CLASSES[variant], applySizeClass, className)}
      {...rest}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}
