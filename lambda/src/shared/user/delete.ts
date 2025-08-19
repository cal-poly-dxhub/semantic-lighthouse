import { updateUser } from ".";

export const deleteUser = async (userId: string): Promise<void> => {
  await updateUser(userId, { deletedAt: new Date().toISOString() });
};
