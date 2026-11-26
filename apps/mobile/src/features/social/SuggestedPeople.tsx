import { ScrollView, StyleSheet, View } from 'react-native';
import { useFollow, useSuggestions } from '@/api/social';
import { useT } from '@/i18n';
import { go } from '@/shell/nav';
import { useColors } from '@/theme/theme';
import { layout, radius, space } from '@/theme/tokens';
import { AppText } from '@/ui/AppText';
import { Avatar } from '@/ui/Avatar';
import { SectionLabel } from '@/ui/Bits';
import { Button } from '@/ui/Button';
import { Tap } from '@/ui/Tap';

/** "Suggested for you": a short horizontal row of people to follow. Hidden when there are none. */
export function SuggestedPeople() {
  const t = useT();
  const colors = useColors();
  const suggestions = useSuggestions();
  const follow = useFollow();
  if (!suggestions.data?.length) return null;
  return (
    <View style={[styles.wrap, { borderBottomColor: colors.divider }]}>
      <SectionLabel label={t('feed.suggested')} style={styles.label} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {suggestions.data.map((person) => {
          const name = person.display_name ?? person.username;
          return (
            <View key={person.id} style={[styles.person, { borderColor: colors.border }]}>
              <Tap onPress={() => go.user(person.id)} style={styles.who} accessibilityLabel={t('a11y.openProfile', { name })}>
                <Avatar url={person.avatar_url} name={name} size={64} />
                <AppText variant="label" weight="semibold" numberOfLines={1} align="center">
                  {name}
                </AppText>
                <AppText variant="caption" tone="textTertiary" numberOfLines={1} align="center">
                  @{person.username}
                </AppText>
              </Tap>
              <Button
                label={t('profile.follow')}
                size="sm"
                block
                onPress={() => follow.mutate({ user: person, follow: true, isPrivate: person.is_private })}
              />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { paddingTop: space.md },
  row: { paddingHorizontal: layout.screenPadding, gap: space.md },
  person: { width: 148, borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.md },
  who: { alignItems: 'center', gap: space.xs },
});
