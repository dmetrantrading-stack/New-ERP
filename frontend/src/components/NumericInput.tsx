import { type InputHTMLAttributes } from 'react';

export type NumericInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string | number;
  onValueChange: (value: string) => void;
};

/** Controlled number input — keeps raw string while typing so backspace can clear a leading zero. */
export default function NumericInput({ value, onValueChange, onFocus, ...rest }: NumericInputProps) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      onFocus={(e) => {
        e.target.select();
        onFocus?.(e);
      }}
      {...rest}
    />
  );
}
