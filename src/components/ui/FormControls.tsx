import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-700 text-white hover:bg-brand-800 border-transparent dark:bg-brand-600 dark:hover:bg-brand-500',
  secondary:
    'bg-white text-slate-800 border-slate-300 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800',
  ghost:
    'bg-transparent text-slate-700 border-transparent hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100',
  danger:
    'bg-red-700 text-white hover:bg-red-800 border-transparent dark:bg-red-600 dark:hover:bg-red-500',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors whitespace-nowrap shrink-0 disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
      {...props}
    />
  );
}

interface FieldWrapperProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function FieldWrapper({
  id,
  label,
  hint,
  error,
  required,
  children,
}: FieldWrapperProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-xs font-medium text-slate-700 dark:text-slate-300"
      >
        {label}
        {required && (
          <span className="ml-1 text-red-600 dark:text-red-400" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-xs font-medium text-red-700 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function Input({
  id,
  label,
  hint,
  error,
  required,
  className = '',
  ...props
}: InputProps) {
  const inputId = id ?? props.name ?? `input-${label ?? 'field'}`;
  const inputEl = (
    <input
      id={inputId}
      required={required}
      aria-invalid={Boolean(error)}
      aria-describedby={
        error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
      }
      className={`h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 disabled:bg-slate-100 disabled:text-slate-500 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-800 ${
        error
          ? 'border-red-500 dark:border-red-500'
          : 'border-slate-300 dark:border-slate-700'
      } ${className}`}
      {...props}
    />
  );

  if (!label) return inputEl;
  return (
    <FieldWrapper
      id={inputId}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      {inputEl}
    </FieldWrapper>
  );
}

interface DatePickerProps extends Omit<InputProps, 'type'> {}

export function DatePicker(props: DatePickerProps) {
  return <Input type="date" {...props} />;
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export function TextArea({
  id,
  label,
  hint,
  error,
  required,
  className = '',
  ...props
}: TextAreaProps) {
  const fieldId = id ?? props.name ?? `textarea-${label ?? 'field'}`;
  const el = (
    <textarea
      id={fieldId}
      required={required}
      aria-invalid={Boolean(error)}
      className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 ${
        error
          ? 'border-red-500 dark:border-red-500'
          : 'border-slate-300 dark:border-slate-700'
      } ${className}`}
      {...props}
    />
  );
  if (!label) return el;
  return (
    <FieldWrapper
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      {el}
    </FieldWrapper>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options: SelectOption[];
}

export function Select({
  id,
  label,
  hint,
  error,
  required,
  options,
  className = '',
  ...props
}: SelectProps) {
  const selectId = id ?? props.name ?? `select-${label ?? 'field'}`;
  const el = (
    <select
      id={selectId}
      required={required}
      aria-invalid={Boolean(error)}
      className={`h-10 w-full rounded-md border bg-white px-3 text-sm text-slate-900 dark:bg-slate-900 dark:text-slate-100 ${
        error
          ? 'border-red-500 dark:border-red-500'
          : 'border-slate-300 dark:border-slate-700'
      } ${className}`}
      {...props}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
  if (!label) return el;
  return (
    <FieldWrapper
      id={selectId}
      label={label}
      hint={hint}
      error={error}
      required={required}
    >
      {el}
    </FieldWrapper>
  );
}
