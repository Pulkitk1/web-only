import { useLocalSearchParams } from 'expo-router';

import { HabitDetailScreen } from '@/components/habit/HabitDetailScreen';

/** Route `habits/{slug}`: Habit Details. */
export default function HabitDetailRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <HabitDetailScreen slug={slug ?? ''} />;
}
