/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lightweight mock of @elastic/eui for unit tests.
 * Provides explicit stubs for every EUI component used in production code.
 * Named exports like EuiTab get special treatment for role-based queries.
 */
import React from 'react';

type Props = Record<string, unknown> & { children?: React.ReactNode; 'data-test-subj'?: string };

const stub =
  (name: string): React.FC<Props> =>
  ({ children, 'data-test-subj': testSubj, ...rest }) => (
    <div data-eui={name} data-test-subj={testSubj}>
      {children}
    </div>
  );

// Specific components that need special HTML for role-based test queries
export const EuiTab: React.FC<Props & { isSelected?: boolean; onClick?: () => void }> = ({
  children,
  isSelected,
  onClick,
  'data-test-subj': testSubj,
}) => (
  <button
    data-eui="EuiTab"
    data-test-subj={testSubj}
    data-selected={isSelected}
    onClick={onClick}
    role="tab"
    aria-selected={isSelected}
  >
    {children}
  </button>
);

export const EuiBasicTable: React.FC<
  Props & { items?: unknown[]; columns?: unknown[]; loading?: boolean }
> = ({ items = [], columns = [], 'data-test-subj': testSubj, loading }) => (
  <table data-eui="EuiBasicTable" data-test-subj={testSubj} data-loading={loading}>
    <tbody>
      {(items as any[]).map((item, i) => (
        <tr key={item?.id ?? i}>
          {(columns as any[]).map((col: any, ci: number) => {
            const val = col.field ? item?.[col.field] : undefined;
            let content: React.ReactNode = val ?? item?.name ?? '';
            try {
              if (typeof col.render === 'function') content = col.render(val, item);
            } catch {
              /* render failed — show raw value */
            }
            return <td key={col.field ?? ci}>{content}</td>;
          })}
          {(columns as any[]).length === 0 && <td>{item?.name ?? ''}</td>}
        </tr>
      ))}
    </tbody>
  </table>
);

// All common EUI components as stubs
export const EuiPage = stub('EuiPage');
export const EuiPageBody = stub('EuiPageBody');
export const EuiPageHeader = stub('EuiPageHeader');
export const EuiPageHeaderSection = stub('EuiPageHeaderSection');
export const EuiTitle = stub('EuiTitle');
export const EuiSpacer = stub('EuiSpacer');
export const EuiTabs = stub('EuiTabs');
export const EuiEmptyPrompt = stub('EuiEmptyPrompt');
export const EuiHealth: React.FC<Props & { color?: string }> = ({
  children,
  color,
  'data-test-subj': testSubj,
}) => (
  <span data-eui="EuiHealth" data-test-subj={testSubj} data-color={color}>
    {children}
  </span>
);
export const EuiBadge: React.FC<Props & { color?: string }> = ({
  children,
  color,
  'data-test-subj': testSubj,
}) => (
  <span data-eui="EuiBadge" data-test-subj={testSubj} data-color={color}>
    {children}
  </span>
);
export const EuiButton: React.FC<Props & { onClick?: () => void; isDisabled?: boolean }> = ({
  children,
  onClick,
  'data-test-subj': testSubj,
}) => (
  <button data-eui="EuiButton" data-test-subj={testSubj} onClick={onClick}>
    {children}
  </button>
);
export const EuiButtonEmpty: React.FC<Props & { onClick?: () => void; isDisabled?: boolean }> = ({
  children,
  onClick,
  'data-test-subj': testSubj,
}) => (
  <button data-eui="EuiButtonEmpty" data-test-subj={testSubj} onClick={onClick}>
    {children}
  </button>
);
export const EuiButtonIcon: React.FC<Props & { onClick?: () => void }> = ({
  children,
  onClick,
  'data-test-subj': testSubj,
}) => (
  <button data-eui="EuiButtonIcon" data-test-subj={testSubj} onClick={onClick}>
    {children}
  </button>
);
export const EuiFlexGroup = stub('EuiFlexGroup');
export const EuiFlexItem = stub('EuiFlexItem');
export const EuiPanel = stub('EuiPanel');
export const EuiText = stub('EuiText');
export const EuiCallOut: React.FC<Props & { title?: React.ReactNode }> = ({
  children,
  title,
  'data-test-subj': testSubj,
}) => (
  <div data-eui="EuiCallOut" data-test-subj={testSubj}>
    {title && <strong>{title}</strong>}
    {children}
  </div>
);
export const EuiComboBox = stub('EuiComboBox');
export const EuiFieldSearch = stub('EuiFieldSearch');
export const EuiFieldText = stub('EuiFieldText');
export const EuiFieldNumber = stub('EuiFieldNumber');
export const EuiSelect = stub('EuiSelect');
export const EuiCheckbox: React.FC<
  Props & { label?: React.ReactNode; checked?: boolean; onChange?: () => void; id?: string }
> = ({ children, label, checked, onChange, id, 'data-test-subj': testSubj }) => (
  <div data-eui="EuiCheckbox" data-test-subj={testSubj}>
    <input type="checkbox" checked={checked} onChange={onChange} id={id} readOnly={!onChange} />
    {label && <label htmlFor={id}>{label}</label>}
    {children}
  </div>
);
export const EuiCheckboxGroup = stub('EuiCheckboxGroup');
export const EuiRadioGroup = stub('EuiRadioGroup');
export const EuiSwitch = stub('EuiSwitch');
export const EuiFormRow: React.FC<
  Props & {
    label?: React.ReactNode;
    helpText?: React.ReactNode;
    isInvalid?: boolean;
    error?: React.ReactNode;
  }
> = ({ children, label, helpText, error, isInvalid, 'data-test-subj': testSubj }) => (
  <div data-eui="EuiFormRow" data-test-subj={testSubj}>
    {label && <label>{label}</label>}
    {children}
    {helpText && <div data-eui="EuiFormHelpText">{helpText}</div>}
    {isInvalid && error && <div data-eui="EuiFormError">{error}</div>}
  </div>
);
export const EuiAccordion: React.FC<Props & { buttonContent?: React.ReactNode }> = ({
  children,
  buttonContent,
  'data-test-subj': testSubj,
}) => (
  <div data-eui="EuiAccordion" data-test-subj={testSubj}>
    {buttonContent && <div data-eui="EuiAccordionButton">{buttonContent}</div>}
    {children}
  </div>
);
export const EuiFlyout = stub('EuiFlyout');
export const EuiFlyoutHeader = stub('EuiFlyoutHeader');
export const EuiFlyoutBody = stub('EuiFlyoutBody');
export const EuiFlyoutFooter = stub('EuiFlyoutFooter');
export const EuiPopover: React.FC<Props & { button?: React.ReactNode; isOpen?: boolean }> = ({
  children,
  button,
  'data-test-subj': testSubj,
}) => (
  <div data-eui="EuiPopover" data-test-subj={testSubj}>
    {button}
    {children}
  </div>
);
export const EuiContextMenuPanel = stub('EuiContextMenuPanel');
export const EuiContextMenuItem = stub('EuiContextMenuItem');
export const EuiCard: React.FC<
  Props & {
    title?: React.ReactNode;
    icon?: React.ReactNode;
    description?: React.ReactNode;
    selectable?: { onClick?: () => void; isSelected?: boolean };
    layout?: string;
    titleSize?: string;
    paddingSize?: string;
  }
> = ({ children, title, description, selectable, ...rest }) => (
  <div data-eui="EuiCard" data-test-subj={rest['data-test-subj']}>
    {title && <div>{title}</div>}
    {description && <div>{description}</div>}
    {children}
    {selectable?.onClick && (
      <button onClick={selectable.onClick} data-selected={selectable.isSelected}>
        Select
      </button>
    )}
  </div>
);
export const EuiConfirmModal: React.FC<
  Props & {
    title?: React.ReactNode;
    onConfirm?: () => void;
    onCancel?: () => void;
    confirmButtonText?: string;
    cancelButtonText?: string;
  }
> = ({
  children,
  title,
  onConfirm,
  onCancel,
  confirmButtonText,
  cancelButtonText,
  'data-test-subj': testSubj,
}) => (
  <div data-eui="EuiConfirmModal" data-test-subj={testSubj}>
    {title && <div>{title}</div>}
    {children}
    {cancelButtonText && <button onClick={onCancel}>{cancelButtonText}</button>}
    {confirmButtonText && <button onClick={onConfirm}>{confirmButtonText}</button>}
  </div>
);
export const EuiModal = stub('EuiModal');
export const EuiModalHeader = stub('EuiModalHeader');
export const EuiModalBody = stub('EuiModalBody');
export const EuiModalFooter = stub('EuiModalFooter');
export const EuiToolTip = stub('EuiToolTip');
export const EuiIconTip = stub('EuiIconTip');
export const EuiIcon = stub('EuiIcon');
export const EuiStat = stub('EuiStat');
export const EuiCodeBlock = stub('EuiCodeBlock');
export const EuiDescriptionList = stub('EuiDescriptionList');
export const EuiHorizontalRule = stub('EuiHorizontalRule');
export const EuiLoadingSpinner = stub('EuiLoadingSpinner');
export const EuiLoadingChart = stub('EuiLoadingChart');
export const EuiLoadingContent = stub('EuiLoadingContent');
export const EuiGlobalToastList = stub('EuiGlobalToastList');
export const EuiFilterGroup = stub('EuiFilterGroup');
export const EuiFilterButton = stub('EuiFilterButton');
export const EuiResizableContainer = ({ children }: any) => {
  // EuiResizableContainer passes a render function; call it with stub Panel, Button, and actions
  if (typeof children === 'function') {
    const PanelStub: any = ({ children: c, ...rest }: any) => (
      <div data-eui="EuiResizablePanel" {...rest}>
        {c}
      </div>
    );
    const ButtonStub: any = (props: any) => <div data-eui="EuiResizableButton" />;
    const actions = { togglePanel: () => {} };
    return <div data-eui="EuiResizableContainer">{children(PanelStub, ButtonStub, actions)}</div>;
  }
  return <div data-eui="EuiResizableContainer">{children}</div>;
};
export const EuiLink = stub('EuiLink');
export const EuiTextArea = stub('EuiTextArea');
export const EuiDatePicker = stub('EuiDatePicker');
export const EuiSuperDatePicker = stub('EuiSuperDatePicker');
export const EuiStep = stub('EuiStep');
export const EuiSteps = stub('EuiSteps');
export const EuiProgress = stub('EuiProgress');
export const EuiRange = stub('EuiRange');
export const EuiTextColor = stub('EuiTextColor');
export const EuiCopy = stub('EuiCopy');
export const EuiOverlayMask = stub('EuiOverlayMask');
export const EuiListGroup = stub('EuiListGroup');
export const EuiListGroupItem = stub('EuiListGroupItem');
export const EuiButtonGroup: React.FC<
  Props & {
    options?: { id: string; label: string }[];
    idSelected?: string;
    onChange?: (id: string) => void;
  }
> = ({ options = [], idSelected, onChange, 'data-test-subj': testSubj }) => (
  <div data-eui="EuiButtonGroup" data-test-subj={testSubj} role="group">
    {options.map((opt: any) => (
      <button
        key={opt.id}
        role="radio"
        aria-checked={opt.id === idSelected}
        onClick={() => onChange?.(opt.id)}
      >
        {opt.label}
      </button>
    ))}
  </div>
);
