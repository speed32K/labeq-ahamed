import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreditNotificationPayload,
  buildSmsHref,
  extractCustomerQueryFromComposer,
  formatCreditSmsMessage,
  formatSmsDayMonth,
  formatTotalDuesLabel,
  lookupCustomerPreviousDue,
  mergeCustomerDetailsIntoRemarks,
  sanitizeMobileNumber,
  validateCreditPopupInput,
} from './creditSms';

test('sanitizeMobileNumber normalizes spaces, hyphens, and optional country code', () => {
  assert.equal(sanitizeMobileNumber('98765 43210'), '9876543210');
  assert.equal(sanitizeMobileNumber('+91 98765-43210'), '+919876543210');
  assert.equal(sanitizeMobileNumber('(987) 654-3210'), '9876543210');
});

test('formatSmsDayMonth formats ISO dates into DD MMM', () => {
  assert.equal(formatSmsDayMonth('2026-11-28'), '28 Nov');
  assert.equal(formatSmsDayMonth('2026-01-05'), '05 Jan');
});

test('validateCreditPopupInput enforces customer name, 10-15 digit mobile, positive amount, and non-negative previous due', () => {
  assert.equal(
    validateCreditPopupInput({ customerName: '', mobileNumber: '9876543210', amount: 500 }).valid,
    false
  );
  assert.equal(
    validateCreditPopupInput({ customerName: 'Rahul', mobileNumber: '12345', amount: 500 }).valid,
    false
  );
  assert.equal(
    validateCreditPopupInput({ customerName: 'Rahul', mobileNumber: '9876543210', amount: 0 }).valid,
    false
  );
  assert.equal(
    validateCreditPopupInput({
      customerName: 'Rahul',
      mobileNumber: '9876543210',
      amount: 500,
      previousDue: -10,
    }).valid,
    false
  );

  const ok = validateCreditPopupInput({
    customerName: '  Rahul Kumar ',
    mobileNumber: '+91 98765-43210',
    amount: 1500,
    previousDue: 2000,
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.normalizedName, 'Rahul Kumar');
  assert.equal(ok.normalizedMobile, '+919876543210');
  assert.equal(ok.normalizedAmount, 1500);
  assert.equal(ok.normalizedPreviousDue, 2000);
});

test('formatCreditSmsMessage matches exact AMD SOLUTIONS format when no previous due exists', () => {
  const payload = buildCreditNotificationPayload({
    customerName: 'Rahul Kumar',
    mobileNumber: '98765 43210',
    amount: 1500,
    entryDate: '2026-11-28',
    previousDue: 0,
  });

  assert.deepEqual(payload.popup_data, {
    customer_name: 'Rahul Kumar',
    mobile_number: '9876543210',
    amount: 1500,
    entry_date: '2026-11-28',
    previous_due: 0,
    total_dues: -1500,
  });

  assert.equal(
    payload.customer_sms,
    [
      'Hi Rahul Kumar, Entry added for Rs -1,500',
      'on 28 Nov. Total dues : Rs -1,500.',
      '',
      'Thank you',
      'AMD SOLUTIONS',
    ].join('\n')
  );
});

test('formatCreditSmsMessage sums unpaid previous due (-PreviousDue) and new credit entry (-CreditAmount)', () => {
  // User scenario: previous due 13,500 (-13,500) + new entry 8,000 (-8,000) = -21,500
  const payload = buildCreditNotificationPayload({
    customerName: 'Rahul Kumar',
    mobileNumber: '9876543210',
    amount: 8000,
    entryDate: '2026-11-28',
    previousDue: 13500,
  });

  assert.equal(payload.popup_data.previous_due, 13500);
  assert.equal(payload.popup_data.total_dues, -21500);
  assert.equal(
    payload.customer_sms,
    [
      'Hi Rahul Kumar, Entry added for Rs -8,000',
      'on 28 Nov. Previous dues : Rs -13,500.',
      'Total dues : Rs -21,500.',
      '',
      'Thank you',
      'AMD SOLUTIONS',
    ].join('\n')
  );

  const secondSms = formatCreditSmsMessage({
    customerName: 'Asha',
    amount: 1500,
    entryDate: '2026-11-28',
    previousDue: 2000,
  });
  assert.equal(
    secondSms,
    [
      'Hi Asha, Entry added for Rs -1,500',
      'on 28 Nov. Previous dues : Rs -2,000.',
      'Total dues : Rs -3,500.',
      '',
      'Thank you',
      'AMD SOLUTIONS',
    ].join('\n')
  );
});

test('buildSmsHref encodes recipient and AMD SOLUTIONS SMS body', () => {
  const msg = formatCreditSmsMessage({
    customerName: 'Asha',
    amount: 250,
    entryDate: '2026-11-28',
    previousDue: 0,
  });
  const href = buildSmsHref('9876543210', msg);
  assert.ok(href.startsWith('sms:9876543210?body='));
  assert.ok(decodeURIComponent(href).includes('AMD SOLUTIONS'));
  assert.ok(decodeURIComponent(href).includes('28 Nov'));
});

test('mergeCustomerDetailsIntoRemarks avoids duplication and caps at 300 chars', () => {
  assert.equal(
    mergeCustomerDetailsIntoRemarks('', 'Rahul Kumar', '9876543210'),
    'Rahul Kumar · 9876543210'
  );
  assert.equal(
    mergeCustomerDetailsIntoRemarks('Rahul Kumar', 'Rahul Kumar', '9876543210'),
    'Rahul Kumar · 9876543210'
  );
  assert.equal(
    mergeCustomerDetailsIntoRemarks('Monthly loan', 'Rahul Kumar', '9876543210'),
    'Monthly loan · Rahul Kumar · 9876543210'
  );
});

test('lookupCustomerPreviousDue sums unpaid credit dues across dates by mobile number and customer name', () => {
  const entriesByDate = {
    '2026-11-25': [
      {
        id: 'c1',
        date: '2026-11-25',
        type: 'SBI CSP',
        serviceType: 'INITIAL DEPOSIT',
        remarks: 'Rahul Kumar · 9876543210',
        paymentMode: 'CREDIT' as const,
        debit: 0,
        credit: 1200,
        customDeltas: null,
      },
      {
        id: 'c2',
        date: '2026-11-25',
        type: 'SBI CSP',
        serviceType: 'INITIAL DEPOSIT',
        remarks: 'Rahul Kumar · 9876543210',
        paymentMode: 'Cash' as const,
        debit: 0,
        credit: 500,
        customDeltas: null,
      },
    ],
    '2026-11-27': [
      {
        id: 'c3',
        date: '2026-11-27',
        type: 'AIRTEL CSP',
        serviceType: 'MONEY TRANSFER',
        remarks: 'Urgent transfer · Rahul Kumar · +919876543210',
        paymentMode: 'CREDIT' as const,
        debit: 0,
        credit: 800,
        customDeltas: null,
      },
      {
        id: 'c4',
        date: '2026-11-27',
        type: 'SHOP',
        serviceType: 'PHOTOCOPY',
        remarks: 'Meera Nair',
        paymentMode: 'CREDIT' as const,
        debit: 0,
        credit: 350,
        customDeltas: null,
      },
    ],
  };

  // Match by mobile (ignores Cash entry c2, sums c1 + c3 = 2000)
  const byMobile = lookupCustomerPreviousDue(entriesByDate, 'Rahul', '98765 43210');
  assert.equal(byMobile.previousDue, 2000);
  assert.equal(byMobile.matchedEntriesCount, 2);
  assert.equal(byMobile.matchedBy, 'mobile');
  assert.deepEqual(byMobile.matchedDates, ['2026-11-25', '2026-11-27']);
  assert.equal(byMobile.matchedCustomerName, 'Rahul Kumar');
  assert.equal(byMobile.matchedMobileNumber, '+919876543210');
  assert.deepEqual(
    byMobile.matchedEntries.map((item) => ({
      id: item.id,
      date: item.date,
      amount: item.amount,
      runningDue: item.runningDue,
    })),
    [
      { id: 'c1', date: '2026-11-25', amount: 1200, runningDue: 1200 },
      { id: 'c3', date: '2026-11-27', amount: 800, runningDue: 2000 },
    ]
  );

  // Match by customer name when mobile is not entered yet
  const byName = lookupCustomerPreviousDue(entriesByDate, 'Meera Nair', '');
  assert.equal(byName.previousDue, 350);
  assert.equal(byName.matchedEntriesCount, 1);
  assert.equal(byName.matchedBy, 'name');
  assert.deepEqual(byName.matchedDates, ['2026-11-27']);
  assert.equal(byName.matchedCustomerName, 'Meera Nair');
  assert.equal(byName.matchedEntries.length, 1);
  assert.equal(byName.matchedEntries[0].runningDue, 350);

  // Unknown customer returns 0 due
  const unknown = lookupCustomerPreviousDue(entriesByDate, 'Unknown Person', '9000011111');
  assert.equal(unknown.previousDue, 0);
  assert.equal(unknown.matchedEntriesCount, 0);
  assert.equal(unknown.matchedBy, null);
  assert.deepEqual(unknown.matchedDates, []);
  assert.deepEqual(unknown.matchedEntries, []);
});

test('extractCustomerQueryFromComposer reads name and mobile from explicit inputs, remarks, and dynamic fields', () => {
  assert.deepEqual(
    extractCustomerQueryFromComposer({
      creditCustomerName: 'Rahul Kumar',
      creditMobileNumber: '98765 43210',
      remarks: 'Other',
      dynamicValues: {},
    }),
    { customerName: 'Rahul Kumar', mobileNumber: '9876543210' }
  );

  // Extracts both name and mobile from Remarks / Party alone
  assert.deepEqual(
    extractCustomerQueryFromComposer({
      remarks: 'Rahul Kumar · 9876543210',
      dynamicValues: {},
    }),
    { customerName: 'Rahul Kumar', mobileNumber: '9876543210' }
  );

  // Extracts from group dynamic fields (SBI CSP Customer Ref + Airtel Mobile No)
  assert.deepEqual(
    extractCustomerQueryFromComposer({
      remarks: '',
      dynamicValues: { dynCustomerRef: 'Meera Nair', dynMobileNo: '+91 91234-56789' },
    }),
    { customerName: 'Meera Nair', mobileNumber: '+919123456789' }
  );
});

test('formatTotalDuesLabel accumulates unpaid dues as negative balances', () => {
  assert.equal(formatTotalDuesLabel(13500, 8000), 'Rs -21,500');
  assert.equal(formatTotalDuesLabel(13500, 0), 'Rs -13,500');
  assert.equal(formatTotalDuesLabel(0, 8000), 'Rs -8,000');
  assert.equal(formatTotalDuesLabel(0, 0), 'Rs 0 (Account Clear ✅)');
});

