import { describe, expect, it } from 'vitest';
import { paymentReceivable, paymentTotals } from '../src/payments.ts';
import type { Payment } from '../src/payments.ts';

const pay = (p: Partial<Payment>): Payment => ({
  id: 1,
  number: '1',
  title: '',
  sentDate: null,
  sentAmount: 0,
  approvedAmount: null,
  receivedAmount: 0,
  receivedDate: null,
  status: 'sent',
  notes: '',
  ...p,
});

describe('مانده‌ی مطالبات صورت‌وضعیت', () => {
  it('مبلغ تأییدشده بر ارسالی مقدم است؛ بدون تأیید همان ارسالی', () => {
    expect(paymentReceivable(pay({ sentAmount: 1000, receivedAmount: 300 }))).toBe(700);
    expect(paymentReceivable(pay({ sentAmount: 1000, approvedAmount: 900, receivedAmount: 300, status: 'approved' }))).toBe(600);
    expect(paymentReceivable(pay({ sentAmount: 1000, approvedAmount: 0, status: 'approved' }))).toBe(0);
  });

  it('در حال تهیه مطالبه نشده و مانده ندارد؛ پرداخت کامل صفر؛ بیش‌پرداخت منفی', () => {
    expect(paymentReceivable(pay({ status: 'preparing', sentAmount: 500 }))).toBe(0);
    expect(paymentReceivable(pay({ sentAmount: 500, receivedAmount: 500, status: 'paid' }))).toBe(0);
    expect(paymentReceivable(pay({ sentAmount: 500, receivedAmount: 700, status: 'paid' }))).toBe(-200);
  });

  it('جمع‌ها: در حال تهیه در ارسالی و مطالبات نمی‌آید؛ دریافتی همه را می‌شمارد', () => {
    const list = [
      pay({ id: 1, sentAmount: 1000, approvedAmount: 900, receivedAmount: 900, status: 'paid' }),
      pay({ id: 2, sentAmount: 2000, receivedAmount: 500, status: 'sent' }),
      pay({ id: 3, sentAmount: 4000, status: 'preparing' }),
    ];
    expect(paymentTotals(list)).toEqual({ count: 3, sent: 3000, approved: 900, received: 1400, receivable: 1500 });
    expect(paymentTotals([])).toEqual({ count: 0, sent: 0, approved: 0, received: 0, receivable: 0 });
  });
});
