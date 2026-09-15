export function useCheckoutState() {
  const itemIds = useState<string[]>('checkout-item-ids', () => []);
  return { itemIds };
}
